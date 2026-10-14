import "dotenv/config";
import pg from "pg";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

// The backup directory is explicit. No remote target or stale backup is accepted.
const directory = path.resolve(process.argv[2] ?? "");
const backupRoot = path.resolve("private-uploads/m35-recovery") + path.sep;
if (!directory.startsWith(backupRoot)) throw new Error("Use a verified private M3.5 backup directory.");
const verification = JSON.parse(await readFile(path.join(directory, "verification.json"), "utf8"));
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname !== verification.target.host || (url.port || "5432") !== verification.target.port ||
    decodeURIComponent(url.pathname.slice(1)) !== verification.target.database ||
    (url.searchParams.get("schema") ?? "public") !== "public" || !verification.restoredExactly)
  throw new Error("Database target does not match the verified local backup.");
const hash = value => createHash("sha256").update(value).digest("hex");
if (hash(await readFile(path.join(directory, "development.dump"))) !== verification.dumpSha256 ||
    hash(await readFile(path.join(directory, "affected-records.json"))) !== verification.affectedRecordsSha256)
  throw new Error("Backup integrity verification failed.");
const client = new pg.Client({ connectionString: url.toString() });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function fingerprint(table, excluded = [], consolidateLocation = false) {
  const columns = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table])).rows
    .map(row => row.column_name).filter(column => !excluded.includes(column));
  const selection = columns.map(column => consolidateLocation && column === "locationText"
    ? `CASE WHEN NULLIF(btrim("locationText"), '') IS NULL AND coalesce(NULLIF(btrim(city), ''), NULLIF(btrim(region), ''), NULLIF(btrim(country), '')) IS NOT NULL THEN concat_ws(', ', NULLIF(btrim(city), ''), NULLIF(btrim(region), ''), NULLIF(btrim(country), '')) ELSE "locationText" END AS "locationText"`
    : quote(column));
  const rows = (await client.query(`SELECT row_to_json(t)::text AS row FROM (SELECT ${selection.join(',')} FROM public.${quote(table)}) t ORDER BY 1`)).rows;
  return { count: rows.length, sha256: hash(JSON.stringify(rows)) };
}
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const applied = (await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(row => row.migration_name);
  const pending = (await readdir("prisma/migrations", { withFileTypes: true })).filter(entry => entry.isDirectory() && !applied.includes(entry.name)).map(entry => entry.name);
  if (pending.length !== 1 || pending[0] !== "20261014010000_candidate_field_cleanup")
    throw new Error("Only the approved M3.5 migration may be pending.");
  const originalTables = {};
  for (const [table, expected] of Object.entries(verification.tables)) {
    const actual = await fingerprint(table);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Database changed since backup; create and verify a fresh backup before migration.");
    originalTables[table] = await fingerprint(table, table === 'CandidateProfile'
      ? ['firstName','lastName','additionalEmails','additionalPhones','city','region','country']
      : table === 'ResumeExtraction' ? ['otherEmails'] : [], table === 'CandidateProfile');
  }
  await client.query("ROLLBACK");
  // Prisma deploy applies forward migrations and records their checksums.
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const results = {};
  for (const [table, expected] of Object.entries(originalTables)) {
    if (table === '_prisma_migrations') continue;
    const actual = await fingerprint(table);
    results[table] = JSON.stringify(actual) === JSON.stringify(expected);
    // Compare with the exact permitted component consolidation; every other
    // retained value, including human clears and statuses, must match unchanged.
    if (!results[table]) throw new Error("Post-migration preservation mismatch; stop and use verified recovery instructions.");
  }
  const remaining = (await client.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND ((table_name='CandidateProfile' AND column_name IN ('firstName','lastName','additionalEmails','additionalPhones','city','region','country')) OR (table_name='ResumeExtraction' AND column_name='otherEmails'))`)).rows[0].count;
  if (remaining) throw new Error("Approved columns were not all removed.");
  await client.query("ROLLBACK");
  await writeFile(path.join(directory, "post-migration-verification.json"), JSON.stringify({ removedColumns: 8, retainedTablesUnchanged: results, localOnly: true }, null, 2));
  console.log(JSON.stringify({ migrationAppliedLocally: true, removedColumns: 8, retainedTablesVerified: Object.keys(results).length, statusesAndEvidenceUnchanged: true }));
} catch (error) {
  console.error(error instanceof Error && !error.code ? error.message : "Local migration failed; inspect migration state and verified backup before continuing.");
  process.exitCode = 1;
} finally { await client.end(); }
