import "dotenv/config";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import path from "node:path";

// Contains private data. The recovery directory is inside ignored private-uploads.
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    (url.searchParams.get("schema") ?? "public") !== "public")
  throw new Error("M3.5 backup requires the confirmed local public schema.");
const source = new pg.Client({ connectionString: url.toString() });
const recoveryName = "m35_restore_" + randomUUID().replaceAll("-", "");
const recoveryUrl = new URL(url);
recoveryUrl.pathname = "/" + recoveryName;
const recovery = new pg.Client({ connectionString: recoveryUrl.toString() });
const directory = path.resolve("private-uploads", "m35-recovery", new Date().toISOString().replace(/[:.]/g, "-"));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => createHash("sha256").update(value).digest("hex");
const commandEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
const args = ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username)];
const tool = name => process.platform === "win32" ? `C:/Program Files/PostgreSQL/16/bin/${name}.exe` : name;
async function fingerprint(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    const rows = (await client.query(`SELECT row_to_json(t)::text AS row FROM public.${quote(tablename)} t ORDER BY 1`)).rows;
    result[tablename] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
let recoveryCreated = false;
try {
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const target = (await source.query("SELECT current_database() AS database, current_schema() AS schema")).rows[0];
  const oldColumns = (await source.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='CandidateProfile' AND column_name IN ('firstName','lastName','additionalEmails','additionalPhones','city','region','country')) OR (table_name='ResumeExtraction' AND column_name='otherEmails'))`)).rows;
  if (oldColumns.length !== 8) throw new Error("M3.5 backup requires the intact pre-migration schema.");
  const profiles = (await source.query('SELECT * FROM "CandidateProfile" ORDER BY "resumeId"')).rows;
  const extractions = (await source.query('SELECT * FROM "ResumeExtraction" ORDER BY "resumeId"')).rows;
  const manualFields = (await source.query(`SELECT r."resumeId",e."fieldPath" FROM "CandidateEvidence" e JOIN "ExtractionRun" r ON r.id=e."runId" WHERE e."verifiedAt" IS NOT NULL AND e."fieldPath" IN ('profile.firstName','profile.lastName','profile.city','profile.region','profile.country','profile.locationText') ORDER BY r."resumeId",e."fieldPath"`)).rows;
  const normalized = value => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const counts = {};
  for (const field of ["firstName", "lastName", "additionalEmails", "additionalPhones", "city", "region", "country"]) {
    counts[field] = profiles.filter(p => Array.isArray(p[field]) ? p[field].length : normalized(p[field]).length).length;
  }
  counts.otherEmails = extractions.filter(e => e.otherEmails?.length).length;
  const byId = new Map(extractions.map(e => [e.resumeId,e]));
  const risks = {
    independentlyDifferentNames: profiles.filter(p => (normalized(p.firstName) || normalized(p.lastName)) && normalized([p.firstName,p.lastName].filter(v => normalized(v)).join(" ")) !== normalized(byId.get(p.resumeId)?.name)).length,
    secondaryContactRecords: profiles.filter(p => p.additionalEmails?.length || !Array.isArray(p.additionalPhones) || p.additionalPhones.length).length + counts.otherEmails,
    componentsWithoutLocation: profiles.filter(p => [p.city,p.region,p.country].some(normalized) && !normalized(p.locationText)).length,
    locationConflicts: profiles.filter(p => normalized(p.locationText) && [p.city,p.region,p.country].some(v => normalized(v) && !normalized(p.locationText).includes(normalized(v)))).length,
    manualLocationClearsWithComponents: profiles.filter(p => !normalized(p.locationText) && [p.city,p.region,p.country].some(normalized) && (p.verifiedAt || manualFields.some(f => f.resumeId===p.resumeId && f.fieldPath==='profile.locationText'))).length,
    manuallyVerifiedSplitNameFields: manualFields.filter(f => ['profile.firstName','profile.lastName'].includes(f.fieldPath)).length,
  };
  await mkdir(directory, { recursive: true });
  const snapshot = { target, profiles, extractions, manualFields };
  const originalJson = JSON.stringify(snapshot, null, 2);
  const recordsPath = path.join(directory, "affected-records.json");
  await writeFile(recordsPath, originalJson, { mode: 0o600, flag: "wx" });
  if (hash(await readFile(recordsPath)) !== hash(originalJson)) throw new Error("Affected-record backup readback failed.");
  const original = await fingerprint(source);
  const exported = (await source.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  const dumpPath = path.join(directory, "development.dump");
  const serverMajor = Math.floor(Number((await source.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
  const nativeMajor = Number(execFileSync(tool("pg_dump"), ["--version"], { encoding: "utf8" }).match(/(\d+)\./)?.[1]);
  let container;
  if (nativeMajor < serverMajor) {
    const matches = execFileSync("docker", ["ps", "--format", "{{.ID}}\t{{.Ports}}"], { encoding: "utf8" }).trim().split("\n").filter(line => line.includes(`:${url.port || "5432"}->5432/tcp`));
    if (matches.length !== 1) throw new Error("Cannot identify one local container with matching PostgreSQL tools.");
    container = matches[0].split("\t")[0];
    const dump = execFileSync("docker", ["exec", "-e", "PGPASSWORD", container, "pg_dump", "--host", "127.0.0.1", "--username", decodeURIComponent(url.username), "--dbname", target.database, "--format=custom", "--snapshot", exported], { env: commandEnv, maxBuffer: 64 * 1024 * 1024 });
    await writeFile(dumpPath, dump, { mode: 0o600, flag: "wx" });
  } else {
    execFileSync(tool("pg_dump"), [...args, "--dbname", target.database, "--format=custom", "--snapshot", exported, "--file", dumpPath], { env: commandEnv, stdio: ["ignore", "ignore", "pipe"] });
  }
  const dumpSha256 = hash(await readFile(dumpPath));
  await source.query("ROLLBACK");
  if (!/^m35_restore_[a-f0-9]{32}$/.test(recoveryName)) throw new Error("Invalid recovery database name.");
  await source.query(`CREATE DATABASE ${quote(recoveryName)}`);
  recoveryCreated = true;
  if (container) {
    execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD", container, "pg_restore", "--host", "127.0.0.1", "--username", decodeURIComponent(url.username), "--dbname", recoveryName, "--exit-on-error", "--no-owner", "--no-privileges"], { env: commandEnv, input: await readFile(dumpPath), maxBuffer: 64 * 1024 * 1024 });
  } else {
    execFileSync(tool("pg_restore"), [...args, "--dbname", recoveryName, "--exit-on-error", "--no-owner", "--no-privileges", dumpPath], { env: commandEnv, stdio: ["ignore", "ignore", "pipe"] });
  }
  await recovery.connect();
  const restored = await fingerprint(recovery);
  if (JSON.stringify(original) !== JSON.stringify(restored)) throw new Error("Restored table fingerprints differ from the source snapshot.");
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of tracked) {
    const destination = path.join(directory, "source", file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file, destination);
  }
  await writeFile(path.join(directory, "working-tree.patch"), execFileSync("git", ["diff", "--binary"]));
  if (process.platform !== "win32") throw new Error("Source archive verification currently requires Windows PowerShell.");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `
    $taskRoot = (Resolve-Path -LiteralPath $env:M35_BACKUP_DIR).Path
    $taskSource = (Resolve-Path -LiteralPath (Join-Path $taskRoot 'source')).Path
    if (-not $taskSource.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe archive source' }
    $taskZip = Join-Path $taskRoot 'source.zip'
    Compress-Archive -LiteralPath $taskSource -DestinationPath $taskZip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
    $taskCount = 0
    try {
      foreach ($taskEntry in $taskArchive.Entries) {
        if ($taskEntry.FullName.EndsWith('/')) { continue }
        $taskOriginal = Join-Path $taskRoot $taskEntry.FullName
        $taskExpected = (Get-FileHash -LiteralPath $taskOriginal -Algorithm SHA256).Hash
        $taskStream = $taskEntry.Open(); $taskHasher = [Security.Cryptography.SHA256]::Create()
        try { $taskActual = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','') }
        finally { $taskStream.Dispose(); $taskHasher.Dispose() }
        if ($taskActual -ne $taskExpected) { throw 'Source archive mismatch' }
        $taskCount++
      }
    } finally { $taskArchive.Dispose() }
    if ($taskCount -ne (Get-ChildItem -LiteralPath $taskSource -File -Recurse).Count) { throw 'Source archive count mismatch' }
    Remove-Item -LiteralPath $taskSource -Recurse -Force
  `], { env: { ...process.env, M35_BACKUP_DIR: directory }, stdio: ["ignore", "ignore", "pipe"] });
  const verification = { target: { ...target, host: url.hostname, port: url.port || "5432" }, counts, risks, tables: original, affectedRecordsSha256: hash(originalJson), dumpSha256, restoredExactly: true, sourceFiles: tracked.length };
  await writeFile(path.join(directory, "verification.json"), JSON.stringify(verification, null, 2));
  console.log(JSON.stringify({ backupDirectory: directory, target: verification.target, counts, risks, restoredExactly: true, tablesVerified: Object.keys(original).length }));
  if (risks.independentlyDifferentNames || risks.secondaryContactRecords || risks.locationConflicts || risks.manualLocationClearsWithComponents)
    throw new Error("Unexpected data requires resolution before migration; backup has been preserved.");
} catch (error) {
  const diagnostic = String(error.stderr ?? "");
  const recognized = ["server version mismatch", "permission denied", "password authentication failed", "connection refused", "invalid snapshot identifier"].find(reason => diagnostic.toLowerCase().includes(reason));
  if (recognized) console.error(JSON.stringify({ backupDiagnostic: recognized }));
  // Never print process stderr or database errors containing candidate values.
  console.error(JSON.stringify({ backupFailed: true, reason: error.code ?? recognized ?? "Backup or recovery verification failed; no migration was applied" }));
  process.exitCode = 1;
} finally {
  await recovery.end().catch(() => {});
  if (recoveryCreated) await source.query(`DROP DATABASE ${quote(recoveryName)}`).catch(() => { console.error("Temporary recovery database cleanup failed."); process.exitCode = 1; });
  await source.end();
}
