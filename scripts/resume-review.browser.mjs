// Real Edge/Chromium component smoke tests with synthetic, intercepted APIs.
// No login, application database writes, or real document downloads are used.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawn } from "node:child_process";
import esbuild from "esbuild";
const root = process.cwd(),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "resumeentry-m31-browser-"));
fs.mkdirSync(temp, { recursive: true });
const truth = JSON.parse(
  fs.readFileSync("test-resumes/ground-truth.json", "utf8"),
).resumes[0].expected;
const period = (d, p) =>
  d
    ? {
        [p + "Year"]: Number(d.slice(0, 4)),
        [p + "Month"]: Number(d.slice(5, 7)),
        [p + "Day"]: null,
        [p + "Text"]: d,
      }
    : {};
const common = { confidence: 0.86, verifiedAt: null };
const candidate = {
  resumeId: "synthetic",
  revision: 4,


  headline: truth.headline,
  summary: truth.summary,
  objective: null,



  locationText: truth.location.text,
  totalExperienceMonths: 135,
  noticePeriod: null,
  employmentPreferences: [],


  dateOfBirth: null,
  verifiedAt: null,
  skills: truth.skills
    .slice(0, 5)
    .map((name, i) => ({
      skillId: "skill-" + i,
      context: "skills",
      ...common,
      skill: { canonicalName: name, category: "Technical", terms: [] },
    })),
  employment: truth.employment.map((j, i) => ({
    id: "job-" + i,
    position: i,
    employer: j.employer,
    designation: j.designation,
    ...period(j.startDate, "start"),
    ...period(j.endDate, "end"),
    isCurrent: j.isCurrent,
    location: j.location,
    employmentType: j.employmentType,
    description: null,
    responsibilities: j.responsibilitiesAndAchievements,
    achievements: [],
    ...common,
  })),
  education: truth.education.map((e, i) => ({
    id: "education-" + i,
    ...e,
    ...period(e.startDate, "start"),
    ...period(e.endDate, "end"),
    ...common,
  })),
  projects: truth.projects.map((p, i) => ({
    id: "project-" + i,
    ...p,
    ...period(p.startDate, "start"),
    ...period(p.endDate, "end"),
    responsibilities: [],
    achievements: [],
    skills: p.skills.map((name) => ({ skill: { canonicalName: name } })),
    ...common,
  })),
  certifications: truth.certifications.map((c, i) => ({
    id: "cert-" + i,
    ...c,
    ...period(c.issueDate, "issue"),
    ...period(c.expiryDate, "expiry"),
    ...common,
  })),
  links: truth.links.map((l, i) => ({
    id: "link-" + i,
    url: l.url,
    type: "PORTFOLIO",
    label: null,
    verifiedAt: null,
  })),
  additional: truth.languages.map((l, i) => ({
    id: "additional-" + i,
    type: "LANGUAGE",
    title: l.name,
    details: { proficiency: l.proficiency },
    ...common,
  })),
};
const fixture = {
  id: "synthetic",
  fileName: "synthetic.pdf",
  fileType: "pdf",
  status: "REVIEW",
  candidate,
  extraction: {
    name: truth.name,
    email: truth.contact.email,
    phone: truth.contact.phone,
    designation: truth.headline,
    overallConfidence: 0.94,
    requiresReview: true,
    reviewedAt: null,
  },
};
const source = `import React from 'react';import{createRoot}from'react-dom/client';import ResumeDetail from '${path.join(root, "app/(workspace)/resumes/[id]/client.tsx").replace(/\\/g, "/")}';import ResumeList from '${path.join(root, "app/(workspace)/resume-list.tsx").replace(/\\/g, "/")}';
window.__record=${JSON.stringify(fixture)};window.__calls=[];window.__errors=[];window.__aborts=0;window.__mode='ok';window.__permissions=['resumes.view','resumes.edit','resumes.download','resumes.export'];
window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
window.fetch=async(url,options={})=>{window.__calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});if(window.__mode==='slow'){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,300);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);window.__aborts++;reject(new DOMException('Aborted','AbortError'));},{once:true});});}if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
if(options.method==='PATCH'){if(window.__mode==='conflict')return Response.json({error:'Candidate changed; reload before editing.'},{status:409});const p=JSON.parse(options.body);if(p.basic)Object.assign(window.__record.extraction,p.basic);if(p.profile)Object.assign(window.__record.candidate,p.profile);window.__record.candidate.revision++;return Response.json({revision:window.__record.candidate.revision});}
if(String(url).includes('provenance'))return Response.json({runs:[],page:1});if(window.__mode==='403')return Response.json({error:'Forbidden'},{status:403});if(window.__mode==='empty')return Response.json(null);
window.__initialLocation ??= window.__record.candidate?.locationText; if(String(url).startsWith('/api/resumes?'))return Response.json({items:[{...window.__record,createdAt:'2026-10-13T00:00:00Z',overview:{name:window.__record.extraction.name,designation:window.__record.extraction.designation,location:window.__record.candidate.locationText,totalExperienceMonths:135,skills:window.__record.candidate.skills.map(s=>s.skill.canonicalName),education:'Bachelor of Science · Computer Science'}}],total:51,pages:3});return Response.json(window.__record);};
const app=createRoot(document.getElementById('root'));window.__mount=(mode='detail',id='synthetic',key='default')=>app.render(mode==='list'?<ResumeList key={key} title='All resumes'/>:<ResumeDetail key={key} id={id}/>);window.__mount(location.pathname==='/resumes'?'list':'detail');`;
let edge, server, socket;
let sequence = 0;
const pending = new Map(),
  errors = [],
  checks = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
};
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate("Boolean(" + expression + ")")) return;
    await delay(50);
  }
  throw new Error("Browser condition timed out: " + expression);
}
async function check(name, expression) {
  if (!(await evaluate(expression))) throw new Error("Failed: " + name);
  checks.push(name);
  console.log("PASS " + name);
}
const setValue = `(element,value)=>{const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));}`;
async function main() {
  await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: "jsx" },
    bundle: true,
    format: "iife",
    jsx: "automatic",
    outfile: path.join(temp, "bundle.js"),
    plugins: [
      {
        name: "fixture-dependencies",
        setup(build) {
          build.onResolve({ filter: /workspace-access$/ }, () => ({
            path: "access",
            namespace: "mock",
          }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({
            path: "link",
            namespace: "mock",
          }));
          build.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(root, args.path.slice(2) + ".ts"),
          }));
          build.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents:
              args.path === "access"
                ? "export const useCan=()=>permission=>window.__permissions.includes(permission);"
                : "import React from 'react';export default function Link(props){return React.createElement('a',props,props.children)}",
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(fs.readFileSync(path.join(temp, "bundle.js")));
    } else if (req.url === "/styles.css") {
      res.setHeader("content-type", "text/css");
      res.end(fs.readFileSync("app/globals.css", "utf8"));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body class="modern-workspace"><div id="root"></div><script src="/bundle.js"></script></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  edge = spawn(
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--remote-debugging-port=9337",
      "--user-data-dir=" + path.join(temp, "edge-profile"),
      "about:blank",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = (
        await (await fetch("http://127.0.0.1:9337/json/list")).json()
      ).find((t) => t.type === "page");
      if (target) break;
    } catch {}
    await delay(100);
  }
  if (!target) throw new Error("Edge DevTools unavailable");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.text);
  });
  await call("Runtime.enable");
  await call("Page.enable");
  const address = "http://127.0.0.1:" + server.address().port;
  await call("Page.navigate", { url: address + "/resumes/synthetic" });
  await waitFor("document.querySelector('h1')?.textContent==='Anika Rao'");
  await check(
    "Detail navigation renders complete sections without runtime crashes",
    "['Identity and career profile','Employment history','Education','Projects and technologies','Certifications','Languages, awards and additional qualifications'].every(s=>document.body.innerText.includes(s))&&window.__errors.length===0",
  );
  await evaluate(
    "document.querySelector('#overview .candidate-editor').open=true;const s=document.querySelector('#overview select');(" +
      setValue +
      ")(s,'designation');",
  );
  await evaluate(
    "(" +
      setValue +
      ")(document.querySelector('#overview textarea'),'Staff Software Developer');document.querySelector('#overview form').requestSubmit();",
  );
  await waitFor(
    "window.__record.extraction.designation==='Staff Software Developer'&&document.body.innerText.includes('Selected field saved and verified.')",
  );
  await check(
    "Basic edit uses M2 revision endpoint and submits only the chosen field",
    "(()=>{const c=window.__calls.find(c=>c.method==='PATCH');return c.url==='/api/resumes/synthetic/candidate'&&c.body.expectedRevision===4&&Object.keys(c.body.basic).join(',')==='designation'})()",
  );
  await evaluate(
    "window.__mode='conflict';document.querySelectorAll('#overview .candidate-editor')[1].open=true;(" +
      setValue +
      ")(document.querySelectorAll('#overview select')[1],'locationText');",
  );
  await evaluate(
    "(" +
      setValue +
      ")(document.querySelectorAll('#overview textarea')[1],'Synthetic City');document.querySelectorAll('#overview form')[1].requestSubmit();",
  );
  await waitFor(
    "document.body.innerText.includes('unsaved changes have been kept')",
  );
  await check(
    "Conflicting revision keeps the unsaved field and explains recovery",
    "document.querySelectorAll('#overview textarea')[1].value==='Synthetic City'&&window.__record.candidate.locationText===window.__initialLocation",
  );
  await evaluate(
    "window.__mode='403';window.__mount('detail','forbidden','forbidden')",
  );
  await waitFor("document.body.innerText.includes('Forbidden')");
  await check(
    "Unsuccessful API response presents a retry action",
    "document.body.innerText.includes('Try again')",
  );
  await evaluate(
    "window.__mode='empty';window.__mount('detail','empty','empty')",
  );
  await waitFor("document.body.innerText.includes('no usable data')");
  await check(
    "Empty-data response shows an error instead of crashing",
    "window.__errors.length===0",
  );
  await evaluate("window.__mode='slow';window.__mount('detail','old','old')");
  await delay(70);
  await evaluate("window.__mode='ok';window.__mount('detail','new','new')");
  await waitFor("document.querySelector('h1')?.textContent==='Anika Rao'");
  await check(
    "Navigation cancels the previous request",
    "window.__aborts>=1&&window.__errors.length===0",
  );
  await evaluate(
    "window.__permissions=['resumes.view'];window.__mount('detail','synthetic','viewer')",
  );
  await waitFor(
    "document.body.innerText.includes('Edit permission is required')",
  );
  await check(
    "View-only user has no correction controls or private document link",
    "!document.querySelector('.candidate-editor')&&!document.body.innerText.includes('Open original resume')",
  );
  await evaluate(
    "window.__permissions=['resumes.view','resumes.edit','resumes.export'];window.__mode='ok';window.__mount('list','synthetic','list')",
  );
  await waitFor("document.querySelector('table tbody tr')");
  await check(
    "Expanded list has all overview columns and identified education",
    "['LOCATION','EXPERIENCE','TOP SKILLS','HIGHEST IDENTIFIED EDUCATION','ACTION'].every(s=>document.body.innerText.includes(s))&&document.body.innerText.includes('Bachelor of Science')",
  );
  await evaluate(
    "(" +
      setValue +
      ")(document.querySelector('[aria-label=\"Filter by processing status\"]'),'REVIEW')",
  );
  await waitFor("window.__calls.some(c=>c.url.includes('status=REVIEW'))");
  await check(
    "Status filter preserves server query navigation",
    "window.__calls.some(c=>c.url.includes('status=REVIEW')&&c.url.includes('page=1'))",
  );
  await evaluate(
    "document.querySelector('[aria-label=\"Next page\"]').click()",
  );
  await waitFor("window.__calls.some(c=>c.url.includes('page=2'))");
  await check(
    "Pagination still requests the next page",
    "window.__calls.some(c=>c.url.includes('page=2')&&c.url.includes('status=REVIEW'))",
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await check(
    "Mobile list scrolls horizontally within its table container",
    "document.querySelector('.table-scroll').scrollWidth>document.querySelector('.table-scroll').clientWidth",
  );
  await evaluate("document.querySelector('.candidate-cell').click()");
  await waitFor(
    "location.pathname==='/resumes/synthetic'&&document.querySelector('h1')?.textContent==='Anika Rao'",
  );
  await check(
    "List View/Review link navigates to the detail route",
    "location.pathname==='/resumes/synthetic'&&window.__errors.length===0",
  );
  if (errors.length) throw new Error("Browser runtime exceptions");
  fs.mkdirSync("docs/evaluation", { recursive: true });
  fs.writeFileSync(
    "docs/evaluation/M3.1-browser.json",
    JSON.stringify(
      {
        browser: "Microsoft Edge headless",
        mode: "Real React components; mocked synthetic HTTP contracts, permissions and Next Link",
        checks,
        passed: checks.length,
        failed: 0,
        limitations: [
          "Does not exercise a live authenticated Next server or database writes; API permission and revision services are tested separately.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("PASS " + checks.length + " browser checks");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (socket?.readyState === 1) await call("Browser.close");
    } catch {}
    socket?.close();
    edge?.kill();
    server?.close();
  });
