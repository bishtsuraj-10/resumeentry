// Complete tests + live Next/Edge review verification in a disposable loopback DB.
// This never seeds or modifies the configured application database.
import "dotenv/config";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { SignJWT } from "jose";

const root = process.cwd();
const base = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw Error("Verification requires a loopback PostgreSQL server.");
const name = "resumeentry_m32_test_" + randomUUID().replaceAll("-", "");
const testUrl = new URL(base);
testUrl.pathname = "/" + name;
testUrl.search = "";
const admin = new Client({ connectionString: base.href, connectionTimeoutMillis: 5000 });
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "resumeentry-m32-live-"));
const port = 3197;
const origin = "http://localhost:" + port;
const secret = randomUUID() + randomUUID();
const checks = [];
let created = false, db, server, edge, socket;
const pending = new Map();
let sequence = 0;
let dismissedDialogs = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function child(command, args, env = {}) {
  return spawn(command, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate("Boolean(" + expression + ")")) return; await delay(100); }
  throw Error("Browser condition timed out: " + expression + " · " + await evaluate("document.body.innerText.slice(0,1500)"));
}
async function check(label, expression) {
  if (!(await evaluate(expression))) throw Error("Failed: " + label + " · " + await evaluate("fetch('/api/resumes/m32-synthetic').then(r=>r.json()).then(r=>JSON.stringify({manualFields:r.manualFields,editor:document.querySelector('#overview .candidate-editor')?.innerText.slice(0,600)}))"));
  checks.push(label); console.log("PASS " + label);
}
const setValue = `(element,value)=>{const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));}`;
async function main() {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  console.log("Created disposable verification database; application data is untouched.");
  if (!process.argv.includes("--browser-only")) {
    const tests = child(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--reporter=default", "--reporter=json", "--outputFile=docs/evaluation/M3.2-tests.json"], { M1_TEST_DATABASE_URL: testUrl.href, M2_TEST_DATABASE_URL: testUrl.href, M3_TEST_DATABASE_URL: testUrl.href });
    tests.stdout.pipe(process.stdout); tests.stderr.pipe(process.stderr);
    const testCode = await new Promise(resolve => tests.on("exit", resolve));
    if (testCode !== 0) throw Error("Complete test suite failed: " + testCode);
  }
  const client = new Client({ connectionString: testUrl.href });
  await client.connect();
  try {
    for (const dir of (await fs.readdir("prisma/migrations")).sort()) {
      if (dir === "migration_lock.toml") continue;
      await client.query(await fs.readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"));
    }
  } finally { await client.end(); }
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl.href }) });
  await db.role.create({ data: { key: "M32_REVIEWER", name: "Synthetic review test", permissions: { create: ["resumes.view", "resumes.edit", "resumes.download"].map(permission => ({ permission })) } } });
  await db.role.create({ data: { key: "M32_VIEWER", name: "Synthetic viewer test", permissions: { create: [{ permission: "resumes.view" }] } } });
  await db.user.create({ data: { id: "m32-reviewer", name: "Synthetic Reviewer", email: "reviewer@example.test", passwordHash: "unused", role: "M32_REVIEWER" } });
  await db.user.create({ data: { id: "m32-viewer", name: "Synthetic Viewer", email: "viewer@example.test", passwordHash: "unused", role: "M32_VIEWER" } });
  const filePath = path.join(storage, "synthetic.pdf");
  await fs.copyFile("tests/fixtures/m3/multi-page.pdf", filePath);
  await db.resume.create({ data: { id: "m32-synthetic", fileName: "synthetic.pdf", filePath, fileType: "pdf", fileSize: BigInt((await fs.stat(filePath)).size), fileHash: "m32-synthetic", status: "REVIEW", extraction: { create: { name: "Synthetic Candidate", email: "candidate@example.test", phone: "+1 512 555 0101", designation: "Engineer", overallConfidence: .91, nameConfidence: .9, emailConfidence: .95, designationConfidence: .85 } }, candidate: { create: { locationText: "Example City", summary: "Persisted professional summary", employment: { create: { position: 0, employer: "Synthetic Employer", designation: "Engineer", responsibilities: ["Persisted responsibility"], startYear: 2020, isCurrent: true } }, education: { create: { position: 0, degree: "BSc", institution: "Synthetic College", endYear: 2019 } }, projects: { create: { position: 0, name: "Synthetic Project", description: "Persisted project description" } }, certifications: { create: { position: 0, name: "Synthetic Certificate", issuer: "Synthetic Issuer" } }, links: { create: { type: "GITHUB", url: "https://example.test/code", label: "Code samples" } }, additional: { create: { position: 0, type: "LANGUAGE", title: "English", details: { proficiency: "Fluent" } } } } } } });
  await db.resume.create({ data: { id: "m32-empty", fileName: "empty.docx", filePath: path.join(storage, "empty.docx"), fileType: "docx", fileSize: 1n, fileHash: "m32-empty", status: "REVIEW" } });
  server = child(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "localhost", "-p", String(port)], { DATABASE_URL: testUrl.href, STORAGE_PATH: storage, AUTH_SECRET: secret, NODE_ENV: "production" });
  let serverLog = "";
  server.stdout.on("data", data => { serverLog += data; }); server.stderr.on("data", data => { serverLog += data; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + "/login")).ok) { ready = true; break; } } catch {} await delay(100); }
  if (!ready) throw Error("Next server unavailable: " + serverLog.slice(-1400));
  edge = child("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9338", "--user-data-dir=" + path.join(storage, "edge"), "about:blank"]);
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await (await fetch("http://127.0.0.1:9338/json/list")).json()).find(t => t.type === "page"); if (target) break; } catch {} await delay(100); }
  if (!target) throw Error("Edge DevTools unavailable");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (request) { pending.delete(message.id); if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result); } if (message.method === "Page.javascriptDialogOpening") { dismissedDialogs++; void call("Page.handleJavaScriptDialog", { accept: false }); } });
  await call("Runtime.enable"); await call("Page.enable"); await call("Network.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: origin + "/resumes/m32-synthetic" });
  await waitFor("location.pathname==='/login'");
  await check("Live unauthenticated detail redirects to login", "location.pathname==='/login'");
  await check("Live original PDF endpoint rejects unauthenticated access", "fetch('/api/resumes/m32-synthetic/file').then(r=>r.status===401)");
  async function login(user) {
    const token = await new SignJWT({ sessionVersion: 0 }).setSubject(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    await call("Network.setCookie", { name: "talentflow_session", value: token, url: origin, httpOnly: true, sameSite: "Strict" });
    return token;
  }
  await login("m32-reviewer");
  await call("Page.navigate", { url: origin + "/resumes/m32-synthetic" });
  await waitFor("document.querySelector('h1')?.textContent==='Synthetic Candidate'");
  await waitFor("document.querySelector('.pdf-render-status')?.textContent==='Page 1 of 2'&&document.querySelector('canvas')?.height>300");
  await check("Live authenticated PDF renders from private storage", "fetch('/api/resumes/m32-synthetic/file').then(r=>r.ok&&r.headers.get('content-type')==='application/pdf')");
  await check("Live persisted relations populate their respective sections", "document.querySelector('#employment').innerText.includes('Synthetic Employer')&&document.querySelector('#education').innerText.includes('Synthetic College')&&document.querySelector('#projects').innerText.includes('Synthetic Project')&&document.querySelector('#certifications').innerText.includes('Synthetic Certificate')&&document.querySelector('#links').innerText.includes('Code samples')&&document.querySelector('#additional').innerText.includes('Fluent')&&document.querySelector('#summary').innerText.includes('Persisted professional summary')");
  await evaluate("document.querySelector('a[href=\"#employment\"]').focus()");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await check("Live keyboard section navigation focuses the section", "document.activeElement.id==='employment'");
  await evaluate("document.querySelector('#overview .candidate-editor').open=true;(" + setValue + ")(document.querySelector('#overview select'),'designation')");
  await evaluate("(" + setValue + ")(document.querySelector('#overview textarea'),'Senior Engineer')");
  await waitFor("document.body.innerText.includes('1 unsaved correction')");
  await check("Live completion waits for pending corrections", "[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review').disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save pending corrections')).click()");
  await waitFor("document.body.innerText.includes('Selected field saved and verified.')");
  const after = await db.resume.findUniqueOrThrow({ where: { id: "m32-synthetic" }, include: { extraction: true, candidate: true } });
  if (after.extraction.designation !== "Senior Engineer" || after.extraction.email !== "candidate@example.test" || after.candidate.revision !== 1 || after.candidate.summary !== "Persisted professional summary") throw Error("Live field patch did not preserve unrelated persisted fields");
  await check("Live partial verification marks only the submitted field", "document.querySelector('#overview .candidate-editor').innerText.includes('Manually verified')&&fetch('/api/resumes/m32-synthetic').then(r=>r.json()).then(r=>r.manualFields.length===1&&r.manualFields[0]==='basic.designation')");
  await evaluate("document.querySelectorAll('#overview .candidate-editor')[1].open=true;(" + setValue + ")(document.querySelectorAll('#overview select')[1],'locationText')");
  await evaluate("(" + setValue + ")(document.querySelectorAll('#overview textarea')[1],'Kept Draft City')");
  await waitFor("document.body.innerText.includes('1 unsaved correction')");
  await evaluate("document.querySelector('.candidate-identity .back-link').click()");
  if (dismissedDialogs !== 1) throw Error("Unsaved navigation warning did not open");
  await check("Live navigation warns about drafts and keeps them when cancelled", "location.pathname==='/resumes/m32-synthetic'&&document.querySelectorAll('#overview textarea')[1].value==='Kept Draft City'");
  await evaluate("fetch('/api/resumes/m32-synthetic/candidate',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,profile:{noticePeriod:'30 days'}})}).then(r=>{if(!r.ok)throw Error('Synthetic concurrent update failed')})");
  await evaluate("document.querySelectorAll('#overview form')[1].requestSubmit()");
  await waitFor("document.body.innerText.includes('unsaved changes have been kept')");
  await check("Live revision conflict keeps the unsaved correction", "document.querySelectorAll('#overview textarea')[1].value==='Kept Draft City'");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload candidate').click()");
  await waitFor("document.body.innerText.includes('30 days')");
  await check("Live reload keeps the draft while refreshing other data", "document.querySelectorAll('#overview textarea')[1].value==='Kept Draft City'");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save pending corrections')).click()");
  await waitFor("![...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review').disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review').click()");
  await waitFor("document.body.innerText.includes('Review completed. Field verification is unchanged.')");
  await check("Live completion preserves partial field verification", "fetch('/api/resumes/m32-synthetic').then(r=>r.json()).then(r=>r.status==='COMPLETED'&&!r.manualFields.includes('basic.email')&&!r.manualFields.includes('profile.summary'))");
  await evaluate("(" + setValue + ")(document.querySelector('#overview select'),'email')");
  await evaluate("(" + setValue + ")(document.querySelector('#overview textarea'),'invalid-email');document.querySelector('#overview form').requestSubmit()");
  await waitFor("document.querySelector('.review-notice[role=alert]')?.textContent.includes('Invalid candidate data')");
  await check("Live validation errors keep the attempted value without altering persisted contacts", "document.querySelector('#overview textarea').value==='invalid-email'&&fetch('/api/resumes/m32-synthetic').then(r=>r.json()).then(r=>r.extraction.email==='candidate@example.test'&&!r.manualFields.includes('basic.email'))");
  await evaluate("document.querySelector('#overview .candidate-editor button[type=button].button-secondary').click()");
  await evaluate("document.querySelector('#employment .candidate-editor').open=true;(" + setValue + ")(document.querySelector('#employment textarea'),'Corrected Employer');document.querySelector('#employment form').requestSubmit()");
  await waitFor("document.querySelector('#employment').innerText.includes('Corrected Employer')");
  await check("Live record correction preserves its other fields and records exact verification", "fetch('/api/resumes/m32-synthetic').then(r=>r.json()).then(r=>r.candidate.employment[0].designation==='Engineer'&&r.candidate.employment[0].responsibilities[0]==='Persisted responsibility'&&r.manualFields.includes('employment.'+r.candidate.employment[0].id+'.employer')&&!r.manualFields.includes('employment.'+r.candidate.employment[0].id+'.designation'))");
  await evaluate("document.querySelector('a[href=\"#overview\"]').click();document.querySelectorAll('#overview .candidate-editor').forEach(d=>d.open=false);document.querySelector('#employment .candidate-editor').open=false");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await check("Live mobile layout stacks panels and has no page overflow", "getComputedStyle(document.querySelector('.candidate-workspace')).gridTemplateColumns.split(' ').length===1&&document.documentElement.scrollWidth<=390");
  await fs.writeFile(path.join(root, "docs/evaluation/M3.2-mobile.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await fs.writeFile(path.join(root, "docs/evaluation/M3.2-desktop.png"), Buffer.from((await call("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await login("m32-viewer");
  await call("Page.navigate", { url: origin + "/resumes/m32-synthetic" });
  await waitFor("document.querySelector('h1')?.textContent==='Synthetic Candidate'");
  await check("Live view-only access hides edits and denies private PDF", "!document.querySelector('.candidate-editor')&&!document.querySelector('canvas')&&fetch('/api/resumes/m32-synthetic/file').then(r=>r.status===403)");
  await login("m32-reviewer");
  await call("Page.navigate", { url: origin + "/resumes/m32-empty" });
  await waitFor("document.querySelector('#employment')?.innerText.includes('No information was extracted')");
  await check("Live legacy and empty optional sections remain reviewable", "document.body.innerText.includes('No structured candidate profile')&&!![...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review')&&document.body.innerText.includes('Preview is available for PDF files')");
  await fs.writeFile("docs/evaluation/M3.2-live-browser.json", JSON.stringify({ browser: "Microsoft Edge headless", mode: "Production Next server, real auth/permissions, disposable PostgreSQL database, private PDF storage", checks, passed: checks.length, failed: 0 }, null, 2) + "\n");
  console.log("PASS " + checks.length + " live browser checks");
}
try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  try { if (socket?.readyState === 1) await call("Browser.close"); } catch {}
  socket?.close(); edge?.kill();
  if (server) { server.kill(); await delay(500); }
  await db?.$disconnect();
  if (created) {
    if (!/^resumeentry_m32_test_[a-f0-9]{32}$/.test(name)) throw Error("Unsafe disposable DB name");
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    console.log("Removed disposable verification database.");
  }
  await admin.end();
  // storage contains only this run's synthetic fixture and isolated browser profile.
  if (path.dirname(storage) === os.tmpdir() && path.basename(storage).startsWith("resumeentry-m32-live-")) await fs.rm(storage, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => console.log("Isolated browser profile remains in temporary storage because Edge still holds a file lock."));
}
