// M3.3 real Edge checks: real React/CSS/PDF.js, synthetic API contracts.
// No login, application database writes, or real document downloads are used.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { spawn } from "node:child_process";
import esbuild from "esbuild";
const root = process.cwd(),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "resumeentry-m33-browser-"));
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
  firstName: truth.firstName,
  lastName: truth.lastName,
  headline: truth.headline,
  summary: truth.summary,
  objective: null,
  city: truth.location.city,
  region: truth.location.region,
  country: truth.location.country,
  locationText: truth.location.text,
  totalExperienceMonths: 135,
  noticePeriod: null,
  employmentPreferences: [],
  additionalEmails: [],
  additionalPhones: [],
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
const nativeFetch=window.fetch.bind(window);
window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
window.fetch=async(url,options={})=>{window.__calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});if(window.__mode==='slow'){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,300);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);window.__aborts++;reject(new DOMException('Aborted','AbortError'));},{once:true});});}if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
if(String(url).endsWith('/file'))return window.__pdfFail?new Response('',{status:403}):nativeFetch('/fixture.pdf',options);
if(options.method==='PATCH'){if(window.__mode==='conflict')return Response.json({error:'Candidate changed; reload before editing.'},{status:409});const p=JSON.parse(options.body);if(p.basic)Object.assign(window.__record.extraction,p.basic);if(p.profile)Object.assign(window.__record.candidate,p.profile);window.__record.manualFields=[...(window.__record.manualFields||[]),...Object.keys(p.basic||{}).map(k=>'basic.'+k),...Object.keys(p.profile||{}).map(k=>'profile.'+k)];if(p.completeReview)window.__record.status='COMPLETED';window.__record.candidate.revision++;return Response.json({revision:window.__record.candidate.revision});}
if(String(url).includes('provenance'))return Response.json({runs:[],page:1});if(window.__mode==='403')return Response.json({error:'Forbidden'},{status:403});if(window.__mode==='empty')return Response.json(null);
if(String(url).startsWith('/api/resumes?'))return Response.json({items:[{...window.__record,createdAt:'2026-10-13T00:00:00Z',overview:{name:window.__record.extraction.name,designation:window.__record.extraction.designation,location:window.__record.candidate.locationText,totalExperienceMonths:135,skills:window.__record.candidate.skills.map(s=>s.skill.canonicalName),education:'Bachelor of Science · Computer Science'}}],total:51,pages:3});return Response.json(window.__record);};
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
  if (!(await evaluate(expression))) throw new Error("Failed: " + name + " · " + await evaluate("JSON.stringify({pdf:document.querySelector('.candidate-document')?.innerText,canvas:[document.querySelector('canvas')?.width,document.querySelector('canvas')?.height],errors:window.__errors})"));
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
    if (req.url === "/pdf.worker.min.mjs") {
      res.setHeader("content-type", "text/javascript");
      res.end(fs.readFileSync("public/pdf.worker.min.mjs"));
    } else if (req.url === "/fixture.pdf") {
      res.setHeader("content-type", "application/pdf");
      res.end(fs.readFileSync("tests/fixtures/m3/mixed.pdf"));
    } else if (req.url === "/bundle.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(fs.readFileSync(path.join(temp, "bundle.js")));
    } else if (req.url === "/styles.css") {
      res.setHeader("content-type", "text/css");
      res.end(fs.readFileSync("app/globals.css", "utf8"));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body class="modern-workspace"><div id="root" style="grid-column:1/-1;min-width:0"></div><script src="/bundle.js"></script></body></html>',
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
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const address = "http://127.0.0.1:" + server.address().port;
  await call("Page.navigate", { url: address + "/resumes/synthetic" });
  await waitFor("document.querySelector('h1')?.textContent==='Anika Rao'");
  await waitFor("document.querySelector('canvas')?.width>300&&document.querySelector('.pdf-render-status')?.textContent.includes('Page 1 of')");
  await check("Private endpoint is used and real PDF.js renders a page", "window.__calls.some(c=>c.url==='/api/resumes/synthetic/file')&&document.querySelector('canvas').height>300");
  await check("Desktop panels scroll independently and header actions remain accessible", "getComputedStyle(document.querySelector('.candidate-section-scroll')).overflowY==='auto'&&getComputedStyle(document.querySelector('.pdf-scroll')).overflowY==='auto'&&document.querySelector('.candidate-sticky-header').getBoundingClientRect().top>=0");
  await evaluate("(" + setValue + ")(document.querySelector('[aria-label=\"PDF zoom\"]'),'100')");
  await waitFor("document.querySelector('canvas').style.width==='595px'");
  await check("PDF zoom renders at the chosen scale", "document.querySelector('[aria-label=\"PDF zoom\"]').value==='100'");
  await evaluate("document.querySelector('[aria-label=\"Next PDF page\"]').click()");
  await waitFor("document.querySelector('.pdf-render-status').textContent==='Page 2 of 2'");
  await check("PDF page navigation respects the page count", "document.querySelector('[aria-label=\"Next PDF page\"]').disabled&&!document.querySelector('[aria-label=\"Previous PDF page\"]').disabled");
  await evaluate("document.querySelector('a[href=\"#employment\"]').click()");
  await waitFor("document.querySelector('a[href=\"#employment\"]').getAttribute('aria-current')==='location'");
  await check("Section navigation moves keyboard focus to the selected section", "document.activeElement.id==='employment'&&document.querySelector('a[href=\"#employment\"]').getAttribute('aria-current')==='location'");
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
      ")(document.querySelectorAll('#overview select')[1],'city');",
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
    "document.querySelectorAll('#overview textarea')[1].value==='Synthetic City'&&window.__record.candidate.city==='Austin'",
  );
  await evaluate("window.__mode='403';[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload candidate').click()");
  await waitFor("document.body.innerText.includes('Could not reload the candidate. Your drafts are kept.')");
  await check("Failed reload retains drafts and blocks saving against stale data", "document.querySelectorAll('#overview textarea')[1].value==='Synthetic City'&&[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save pending corrections')).disabled");
  await evaluate("window.__mode='ok';[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload candidate').click()");
  await waitFor("document.querySelectorAll('#overview textarea')[1].value==='Synthetic City'&&!document.querySelectorAll('#overview textarea')[1].disabled");
  await check("Reload preserves the conflicting draft", "document.querySelectorAll('#overview textarea')[1].value==='Synthetic City'");
  await check("Review completion is disabled while drafts remain", "[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review').disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save pending corrections')).click()");
  await waitFor("window.__record.candidate.city==='Synthetic City'&&[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review')?.disabled===false");
  await check("Header saves only pending field corrections", "(()=>{const c=window.__calls.filter(c=>c.method==='PATCH').at(-1);return Object.keys(c.body.profile).join(',')==='city'&&!c.body.basic&&!c.body.completeReview})()");
  await check("Partial verification is displayed without verifying unrelated fields", "window.__record.manualFields.includes('profile.city')&&!window.__record.manualFields.includes('profile.summary')&&!window.__record.manualFields.includes('basic.email')&&!!document.querySelector('#overview [aria-label=\"Manually verified\"]')");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review').click()");
  await waitFor("document.body.innerText.includes('Review completed. Field verification is unchanged.')");
  await check("Review completion submits only its workflow flag and revision", "(()=>{const c=window.__calls.filter(c=>c.method==='PATCH').at(-1);return c.body.completeReview===true&&Object.keys(c.body).length===2})()");
  await evaluate("(" + setValue + ")(document.querySelector('#overview select'),'email');document.querySelector('#summary .candidate-editor').open=true;(" + setValue + ")(document.querySelector('#summary select'),'summary')");
  await evaluate("(" + setValue + ")(document.querySelector('#overview textarea'),'corrected@example.test');(" + setValue + ")(document.querySelector('#summary textarea'),'Corrected synthetic summary')");
  await waitFor("document.body.innerText.includes('2 unsaved corrections')");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save pending corrections')).click()");
  await waitFor("window.__record.extraction.email==='corrected@example.test'&&window.__record.candidate.summary==='Corrected synthetic summary'");
  await check("Header batches drafts across sections in one revision without unrelated fields", "(()=>{const c=window.__calls.filter(c=>c.method==='PATCH').at(-1);return Object.keys(c.body.basic).join(',')==='email'&&Object.keys(c.body.profile).join(',')==='summary'&&!c.body.completeReview})()");
  await evaluate("window.__pdfFail=true;window.__mount('detail','synthetic','pdf-failure')");
  await waitFor("document.body.innerText.includes('Original PDF unavailable (403)')");
  await check("PDF access failure preserves candidate information and offers recovery", "document.querySelector('h1').textContent==='Anika Rao'&&document.body.innerText.includes('Retry PDF preview')&&!!document.querySelector('.document-heading a')");
  await evaluate("window.__pdfFail=false;[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry PDF preview').click()");
  await waitFor("document.querySelector('.pdf-render-status')?.textContent.includes('Page 1 of')");
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
  await check("Document permission blocks the preview request", "!document.querySelector('.document-heading a')&&!document.querySelector('canvas')");
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
  await check("Mobile workspace stacks panels without page overflow", "getComputedStyle(document.querySelector('.candidate-workspace')).gridTemplateColumns.split(' ').length===1&&document.documentElement.scrollWidth<=390");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.__record.candidate.summary=('Experienced engineer delivering reliable products. ').repeat(80);window.__record.candidate.employment=Array.from({length:30},(_,i)=>({...window.__record.candidate.employment[0],id:'stress-job-'+i,employer:'Synthetic employer '+i}));window.__record.candidate.skills=Array.from({length:60},(_,i)=>({...window.__record.candidate.skills[0],skillId:'stress-skill-'+i,skill:{canonicalName:'Synthetic skill '+i,category:'Technical',terms:[]}}));window.__mount('detail','synthetic','stress')");
  await waitFor("document.querySelectorAll('#employment .candidate-record').length>=30 || document.querySelector('#employment')?.innerText.includes('Synthetic employer 29')");
  await waitFor("document.querySelector('canvas')?.width>300");
  await check("Grouped navigation contains six accessible links", "document.querySelectorAll('.candidate-section-links a').length===6");
  await check("Fit width keeps original PDF within its panel", "document.querySelector('canvas').getBoundingClientRect().width<=document.querySelector('.pdf-scroll').clientWidth");
  await evaluate("(" + setValue + ")(document.querySelector('[aria-label=\"Information panel width\"]'),'65')");
  await waitFor("document.querySelector('canvas').getBoundingClientRect().width<350");
  await check("PDF fit reacts to panel resizing and retains page aspect", "document.querySelector('canvas').getBoundingClientRect().width<=document.querySelector('.pdf-scroll').clientWidth&&Math.abs(document.querySelector('canvas').width/document.querySelector('canvas').height-595/842)<0.01");
  await evaluate("document.querySelector('.candidate-section-links a[href=\"#education\"]').click()");
  await waitFor("document.querySelector('.candidate-section-links a[href=\"#education\"]').getAttribute('aria-current')==='location'");
  await check("Long history remains navigable and focused", "document.activeElement.id==='education'&&document.querySelector('#candidate-information-scroll').scrollTop>500");
  await evaluate("document.querySelector('#candidate-information-scroll').scrollTop=0");
  await waitFor("document.querySelector('.candidate-section-links a[href=\"#overview\"]').getAttribute('aria-current')==='location'");
  await check("Manual scrolling synchronizes the active group", "document.querySelector('.candidate-section-links a[aria-current]').getAttribute('href')==='#overview'");
  fs.mkdirSync('docs/evaluation',{recursive:true});
  fs.writeFileSync('docs/evaluation/M3.3-stress-desktop.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  await check("Large skills and long summary fit mobile width", "document.documentElement.scrollWidth<=390&&document.querySelector('#skills').innerText.includes('Synthetic skill 59')");
  await check("Mobile document follows the information panel without overlap", "document.querySelector('.candidate-document').getBoundingClientRect().top>=document.querySelector('.candidate-information').getBoundingClientRect().bottom");
  fs.writeFileSync('docs/evaluation/M3.3-stress-mobile.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("window.__record.candidate.skills=[];window.__record.candidate.employment=[];window.__record.candidate.education=[];window.__record.candidate.projects=[];window.__record.candidate.certifications=[];window.__record.candidate.links=[];window.__record.candidate.additional=[];window.__mount('detail','synthetic','empty-sections')");
  await waitFor("document.querySelector('#employment')?.innerText.includes('No information was extracted')");
  await check("Empty optional relations retain all sections and review actions", "['skills','employment','education','projects','certifications','links','additional'].every(id=>document.getElementById(id).innerText.includes('No information was extracted'))&&!![...document.querySelectorAll('button')].find(b=>b.textContent==='Complete review')&&window.__errors.length===0");
  if (errors.length) throw new Error("Browser runtime exceptions");
  fs.mkdirSync("docs/evaluation", { recursive: true });
  fs.writeFileSync(
    "docs/evaluation/M3.3-browser.json",
    JSON.stringify(
      {
        browser: "Microsoft Edge headless",
        mode: "Real React components, CSS, PDF.js rendering; synthetic HTTP contracts, permissions and Next Link",
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
  .catch(async (e) => {
    console.error(e.message); try { console.error(await evaluate("JSON.stringify({active:document.activeElement.id,links:[...document.querySelectorAll('.candidate-section-links a')].map(e=>[e.hash,e.getAttribute('aria-current')]),scroll:[document.querySelector('.candidate-section-scroll')?.scrollTop,document.querySelector('.candidate-section-scroll')?.clientHeight,document.querySelector('.candidate-section-scroll')?.scrollHeight],layout:[...document.querySelectorAll('#root,main,.candidate-workspace,.candidate-information,.candidate-document')].map(e=>({cls:e.className,w:e.clientWidth,grid:getComputedStyle(e).gridTemplateColumns})),text:document.body.innerText.slice(-300),width:document.querySelector('.pdf-scroll')?.clientWidth,canvas:document.querySelector('canvas')?.width})")); } catch {}
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (socket?.readyState === 1) await call("Browser.close");
    } catch {}
    socket?.close();
    edge?.kill();
    server?.closeAllConnections();
    server?.close();
    esbuild.stop();
  });
