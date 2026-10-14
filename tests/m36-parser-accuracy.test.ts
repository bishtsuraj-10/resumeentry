import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractStructuredResume, LocalResumeParser } from "../lib/resume-parser";
import { readPdfLayout } from "../lib/resume-parser/pdf-layout";
import { accuracyFor, type AccuracyCase } from "../lib/resume-parser/corpus-accuracy";
import { positionedPdf } from "./helpers/positioned-pdf";
import { experienceMonths, parseDate } from "../lib/resume-parser/validators/dates";

const truth = JSON.parse(await readFile("test-resumes/ground-truth.json", "utf8")) as { asOfDate: string; resumes: AccuracyCase[] };
const asOf = new Date(truth.asOfDate + "T00:00:00Z");
const parse = (text: string) => extractStructuredResume(text, { asOf });
describe("M3.6 original PDF accuracy gates", () => {
  it.each(truth.resumes)("preserves mandatory fields, URL ownership and employment tuples in $id", async item => {
    const file = path.join("test-resumes", item.file);
    expect(createHash("sha256").update(await readFile(file)).digest("hex")).toBe(item.sha256);
    const document = await new LocalResumeParser().extractText(file);
    const report = accuracyFor(item, extractStructuredResume(document.text, { asOf, documentWarnings: document.warnings }), asOf);
    for (const field of ["basic.name", "basic.email", "basic.normalizedPhone", "basic.designation", "profile.locationText", "profile.summary", "links.url", "projects.url", "certifications.url", "employment.employer", "employment.designation", "employment.startDate", "employment.endDate"]) {
      expect(report.fields[field].fn, `${item.id}: ${field} missing`).toBe(0);
      expect(report.fields[field].fp, `${item.id}: ${field} extra`).toBe(0);
    }
    expect(report.employmentTuples.exact).toBe(item.expected.employment.length);
    expect(report.employmentTuples.extra).toBe(0);
    expect(report.experience.conventionExact).toBe(true);
    expect(report.experience.benchmarkDelta).toBe(-1);
    expect(report.automaticCompletion).toBe("LAYER_1");
  }, 60000);
});
describe("M3.6 PDF annotation and column regressions", () => {
  it("reads annotation-only labels through the document reader, deduplicates and preserves URL ownership", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resume-m36-"));
    try {
      const file = path.join(directory, "annotations.pdf");
      await writeFile(file, positionedPdf([
        { text: "ALEX MORGAN" }, { text: "Software Engineer" }, { text: "Profiles" },
        { text: "LinkedIn", url: "https://linkedin.com/in/alex" },
        { text: "https://linkedin.com/in/alex", url: "https://linkedin.com/in/alex" },
        { text: "Portfolio", url: "https://alex.example.com/work" },
        { text: "Employer website", url: "https://employer.example.com" },
        { text: "Projects" }, { text: "Project: Deployment Tool" },
        { text: "Project website", url: "https://project.example.com/demo" },
        { text: "Certifications" }, { text: "Certification: Cloud Systems" },
        { text: "Credential", url: "https://credentials.example.com/alex" },
        { text: "References" }, { text: "Referee LinkedIn", url: "https://linkedin.com/in/referee" },
      ]));
      const document = await new LocalResumeParser().extractText(file);
      const parsed = parse(document.text);
      expect(parsed.candidate.links?.upsert?.map(l => l.url)).toEqual(["https://linkedin.com/in/alex", "https://alex.example.com/work"]);
      expect(parsed.candidate.projects?.upsert?.[0].url).toBe("https://project.example.com/demo");
      expect(parsed.candidate.certifications?.upsert?.[0].url).toBe("https://credentials.example.com/alex");
      expect(parsed.evidence.some(e => e.fieldPath === "links.0.url" && e.text.includes("LinkedIn"))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("keeps a leading right-column summary heading with its body", async () => {
    const lines = [{ text: "ALEX MORGAN", x: 40, y: 800 }, { text: "Software Engineer", x: 40, y: 780 }, { text: "SUMMARY", x: 290, y: 750 }, { text: "CONTACT", x: 40, y: 730 }];
    for (let i = 0; i < 15; i++) {
      lines.push({ text: i === 0 ? "alex@example.com" : `Contact detail ${i}`, x: 40, y: 710 - i * 20 });
      lines.push({ text: i === 0 ? "Builds reliable distributed services." : `Supports service capability ${i}.`, x: 290, y: 710 - i * 20 });
    }
    const document = await readPdfLayout(positionedPdf(lines), 25);
    expect(parse(document.pages[0].text).candidate.profile?.summary).toContain("Builds reliable distributed services.");
    expect(parse(document.pages[0].text).candidate.profile?.summary).not.toContain("Contact detail");
  });
  it("ignores unsafe or unplaced annotations", async () => {
    const document = await readPdfLayout(positionedPdf([{ text: "ALEX MORGAN" }, { text: "Website", url: "javascript:alert(1)" }]), 25);
    expect(parse(document.pages[0].text).candidate.links).toBeUndefined();
  });
});
describe("M3.6 conservative text regressions", () => {
  it.each(["https:/alex.example.com/work", "https//alex.example.com/work", "https: //alex.example.com/work", "alex.example.com/work", "www.alex.example.com/work", "linkedin.com/in/alex", "github.com/alex"])("retains the fully stated destination %s", url => {
    expect(parse(`ALEX MORGAN\nProfiles\nPortfolio: ${url}`).candidate.links?.upsert).toHaveLength(1);
  });
  it("does not extract email domains, unrelated labelled destinations or unsafe schemes", () => {
    expect(parse("ALEX MORGAN\nalex@example.com\nEmployer website: https://employer.example.com\nReference: https://referee.example.com\nAdvertisement: https://ads.example.com\nPortfolio: javascript:alert(1)").candidate.links).toBeUndefined();
  });
  it("retains independently presented portfolio links when also used by a project", () => {
    const parsed = parse("ALEX MORGAN\nPortfolio: https://alex.example.com/demo\nProjects\nProject: Demo\nURL: https://alex.example.com/demo");
    expect(parsed.candidate.links?.upsert?.[0].url).toBe("https://alex.example.com/demo");
    expect(parsed.candidate.projects?.upsert?.[0].url).toBe("https://alex.example.com/demo");
  });
  it.each([
    ["Washington, District of\nColumbia, United States", "Washington, District of Columbia, United States"],
    ["Location: London, United\nKingdom", "London, United Kingdom"],
    ["Location: Dubai, United Arab\nEmirates", "Dubai, United Arab Emirates"],
    ["Address: 12 Rajpur Road\nDehradun, Uttarakhand 248001\nIndia\nEmail: alex@example.com", "12 Rajpur Road, Dehradun, Uttarakhand 248001, India"],
    ["Dehradun, Uttarakhand 248001", "Dehradun, Uttarakhand 248001"],
    ["Based in: Bengaluru, Karnataka, India", "Bengaluru, Karnataka, India"],
    ["Location: Bengaluru\nKarnataka\nIndia", "Bengaluru, Karnataka, India"],
    ["Location:\nBengaluru\nKarnataka\nIndia", "Bengaluru, Karnataka, India"],
  ])("retains complete candidate address %s", (text, expected) => {
    expect(parse(`ALEX MORGAN\n${text}`).candidate.profile?.locationText).toBe(expected);
  });
  it("excludes company, university and project locations", () => {
    expect(parse("ALEX MORGAN\nCompany address: Mumbai, Maharashtra, India\nUniversity location: Delhi, India\nProjects\nLocation: Pune, India").candidate.profile?.locationText).toBeUndefined();
  });
  it.each(["Senior Platform Engineer", "Principal Cybersecurity Analyst", "Clinical Research Coordinator", "Freelance Graphic Designer"])("preserves specialty and seniority in %s", title => {
    expect(parse(`ALEX MORGAN\n${title}\nSummary\nExperienced engineer focused on collaborative delivery.\nExperience\nSoftware Engineer | Prior Systems | Jan 2020 - Dec 2021`).basic.designation).toBe(title);
  });
  it("does not use an ambiguous summary sentence as a designation", () => {
    expect(parse("ALEX MORGAN\nSummary\nWorks alongside a Software Engineer to support quality and teamwork.").basic.designation).toBeNull();
  });
  it("keeps the headline independently while preferring the current employment title", () => {
    const parsed = parse("ALEX MORGAN\nSoftware Engineer\nExperience\nSenior Platform Engineer | Current Systems | Jan 2024 - Present\nSoftware Engineer | Prior Systems | Jan 2020 - Dec 2023");
    expect(parsed.candidate.profile?.headline).toBe("Software Engineer");
    expect(parsed.basic.designation).toBe("Senior Platform Engineer");
  });
  it("preserves table cells as associated employer, role and date tuples", () => {
    const parsed = parse("ALEX MORGAN\nExperience\nEmployer\tDesignation\tDates\nExample Systems\tSoftware Engineer\tJan 2024 - Present");
    expect(parsed.candidate.employment?.upsert?.map(e => [e.employer, e.designation, e.startDate?.year, e.startDate?.month, e.isCurrent])).toEqual([["Example Systems", "Software Engineer", 2024, 1, true]]);
  });
  it("preserves separate ongoing, contract and internship tuples at one employer", () => {
    const parsed = parse("ALEX MORGAN\nExperience\nSenior Software Engineer | Example Systems | Jan 2024 - Present\nContract Software Engineer | Example Systems | Jan 2022 - Dec 2023\nSoftware Engineer Intern | Example Systems | Jan 2021 - Dec 2021");
    expect(parsed.candidate.employment?.upsert?.map(e => [e.designation, e.employer, e.startDate?.year, e.endDate?.year ?? null, e.isCurrent])).toEqual([
      ["Senior Software Engineer", "Example Systems", 2024, null, true],
      ["Contract Software Engineer", "Example Systems", 2022, 2023, false],
      ["Software Engineer Intern", "Example Systems", 2021, 2021, false],
    ]);
  });
  it("counts overlapping completed intervals once and excludes the current month", () => {
    expect(experienceMonths([
      { startDate: parseDate("Jan 2024"), endDate: parseDate("Dec 2024") },
      { startDate: parseDate("Jul 2024"), isCurrent: true },
    ], new Date("2026-10-13T00:00:00Z"))).toBe(33);
  });
  it.each([
    ["Experience", "Freelance Software Engineer", "Freelance"],
    ["Experience", "Contract Software Engineer", "Contract"],
    ["Internships", "Software Engineer Intern", "Internship"],
  ])("retains source-supported employment type %s / %s / %s", (section, title, employmentType) => {
    const parsed = parse(`ALEX MORGAN\n${section}\n${title} | Example Systems | Jan 2024 - Dec 2024\nEmployment type: ${employmentType}`);
    expect(parsed.candidate.employment?.upsert?.[0].employmentType).toBe(employmentType);
    expect(parsed.candidate.employment?.upsert?.[0].designation).toBe(title);
  });
  it.each(["2024 - Present", "Jan 2024", "Jan 2024 - 2025"])("does not invent experience for insufficient dates %s", dates => {
    expect(parse(`ALEX MORGAN\nExperience\nFreelance Software Engineer | Example Systems | ${dates}`).candidate.profile?.totalExperienceMonths).toBeUndefined();
  });
});
