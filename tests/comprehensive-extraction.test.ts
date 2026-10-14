import { describe, expect, it } from "vitest";
import { extractStructuredResume } from "../lib/resume-parser";
import {
  dateRange,
  experienceMonths,
  parseDate,
} from "../lib/resume-parser/validators/dates";
import { assessTextQuality } from "../lib/resume-parser/text-normalizer";
import { corpus } from "./fixtures/m3-corpus";
import { evaluateCorpus } from "../lib/resume-parser/evaluation";
const parse = (text: string) =>
  extractStructuredResume(text, { asOf: new Date("2026-10-01T00:00:00Z") });
describe("deterministic comprehensive extraction", () => {
  it("retains national phone text for review without inventing a country code", () => {
    const r = parse("ALEX MORGAN\nPhone: 98765 43210");
    expect(r.basic.phone).toBe("98765 43210");
    expect(r.basic.countryCode).toBeNull();
    expect(r.basic.normalizedPhone).toBeNull();
    expect(r.warnings).toContain("UNRESOLVED_PHONE_COUNTRY");
  });
  it.each(corpus)("extracts supported fields in $id", (fixture) => {
    const result = parse(fixture.text);
    expect(result.basic.name).toBe(fixture.expected["basic.name"]);
    expect(result.basic.email).toBe(fixture.expected["basic.email"]);
    expect(result.warnings).not.toContain("STRUCTURED_VALIDATION_FAILED");
    expect(
      result.evidence.every(
        (e) => e.text.length <= 500 && e.confidence >= 0 && e.confidence <= 1,
      ),
    ).toBe(true);
  });
  it("evaluates actual precision, recall, misses and false positives", () => {
    const report = evaluateCorpus(corpus);
    expect(report.documentCount).toBe(18);
    expect(report.documentSuccess).toBe(18);
    expect(report.totals.precision).toBeGreaterThan(0.9);
    expect(report.totals.recall).toBeGreaterThan(0.9);
    expect(report.fields["employment.employer"].fn).toBeGreaterThan(0); // Documented conservative miss.
    const negative = evaluateCorpus([
      { id: "negative", text: "ALEX MORGAN\nalex@example.com", expected: {} },
    ]);
    expect(negative.totals.fp).toBeGreaterThan(0);
  });
  it("does not infer skills from titles, substrings or ambiguous prose", () => {
    const result = parse(
      "ALEX MORGAN\nJava Developer\nSummary\nGo to market with a leadership team. R and js are ordinary text.\nSkills\nJavaScript, TypeScript, C++, C#, Rusty, Django",
    );
    const names = result.candidate.skills!.upsert!.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "JavaScript",
        "TypeScript",
        "C++",
        "C#",
        "Django",
      ]),
    );
    expect(names).not.toEqual(expect.arrayContaining(["Java"]));
    expect(names).not.toContain("Go");
    expect(names).not.toContain("R");
    expect(names).not.toContain("Leadership");
  });
  it("deduplicates aliases and keeps multiple source occurrences", () => {
    const r = parse(
      "ALEX MORGAN\nSkills: React.js, ReactJS, React\nProjects\nProject: Test\nTechnologies: React",
    );
    expect(r.candidate.skills?.upsert).toHaveLength(1);
    expect(
      r.evidence.filter((e) => e.fieldPath === "skills.0.name"),
    ).toHaveLength(4);
  });
  it("excludes references, recruiter contacts and reference profile links", () => {
    const r = parse(corpus.find((c) => c.id === "references")!.text);
    expect(r.basic).not.toHaveProperty("otherEmails");
    expect(r.candidate.links).toBeUndefined();
    expect(r.basic.designation).toBe("Software Engineer");
    expect(
      parse(
        "Recruiter: recruiter@example.com\nReferences\nOTHER PERSON\nother@example.com",
      ).basic.email,
    ).toBeNull();
  });
  it("does not invent identity from file names, dates of birth or summaries", () => {
    const r = parse("Education\nExample University\nAge: 30\nGraduated: 2020");
    expect(r.basic.name).toBeNull();
    expect(r.candidate.profile?.dateOfBirth).toBeUndefined();
    expect(r.candidate.profile?.summary).toBeUndefined();
  });
  it("handles Unicode names without inferring nationality", () => {
    const r = parse("Name: José Silva\nEmail: jose@example.com");
    expect(r.basic.name?.toLowerCase()).toBe("josé silva");
    expect(r.candidate.profile ?? {}).not.toHaveProperty("country");
  });
  it("preserves partial dates and merges overlapping monthly periods", () => {
    expect(parseDate("2021")).toEqual({ year: 2021, text: "2021" });
    expect(parseDate("Feb 2021")).toEqual({
      year: 2021,
      month: 2,
      text: "Feb 2021",
    });
    expect(parseDate("2021-02-29")).toBeNull();
    expect(dateRange("2025 - 2021")).toBeNull();
    const entries = [
      { startDate: parseDate("Jan 2020"), endDate: parseDate("Dec 2022") },
      { startDate: parseDate("Jan 2022"), endDate: parseDate("Dec 2024") },
    ];
    expect(experienceMonths(entries, new Date("2026-10-01"))).toBe(60);
    expect(
      experienceMonths(
        [{ startDate: parseDate("2020"), endDate: parseDate("2024") }],
        new Date(),
      ),
    ).toBeNull();
  });
  it("supports promotions and internships without creating employers", () => {
    const r = parse(
      "ALEX MORGAN\nInternships\nSoftware Engineer at Example Internship | Jan 2020 - Mar 2020\nExperience\nSoftware Engineer at Example Corp | Apr 2020 - Dec 2021\nSenior Software Engineer at Example Corp | Jan 2022 - Present",
    );
    expect(r.candidate.employment?.upsert).toHaveLength(3);
    expect(r.candidate.employment?.upsert?.[0].employmentType).toBe(
      "Internship",
    );
  });
  it("retains explicit experience, notice period and preferences", () => {
    const r = parse(
      "ALEX MORGAN\nTotal Experience: 5 years 6 months\nNotice Period: 30 days\nEmployment Preferences: Remote, Contract",
    );
    expect(r.candidate.profile).toMatchObject({
      totalExperienceMonths: 66,
      noticePeriod: "30 days",
      employmentPreferences: ["Remote", "Contract"],
    });
    expect(
      parse("ALEX MORGAN\nSummary\nOver 5 years of experience").candidate
        .profile?.totalExperienceMonths,
    ).toBeUndefined();
  });
  it("parses multiple education, named projects, credentials and links", () => {
    const r = parse(
      "ALEX MORGAN\nLinkedIn: linkedin.com/in/synthetic\nGitHub: https://github.com/synthetic\nPortfolio: https://example.com/portfolio\nEducation\nB.Sc\nInstitution: Example College\nMBA\nInstitution: Example School\nProjects\nProject: Alpha\nRole: Developer\nTechnologies: Python\nProject: Beta\nTechnologies: SQL\nCertifications\nCertification: Foundation\nIssuer: Example Board\nIssue Date: Jan 2021\nExpiry Date: Jan 2025\nCredential ID: SYN-1\nCredential URL: https://example.com/credential",
    );
    expect(r.candidate.education?.upsert).toHaveLength(2);
    expect(r.candidate.projects?.upsert).toHaveLength(2);
    expect(r.candidate.links?.upsert).toHaveLength(3);
    expect(r.candidate.certifications?.upsert?.[0]).toMatchObject({
      name: "Foundation",
      issuer: "Example Board",
      credentialId: "SYN-1",
      issueDate: { year: 2021, month: 1 },
      expiryDate: { year: 2025, month: 1 },
    });
  });
  it("does not spill unknown headings into a prior known section", () => {
    const r = parse(
      "ALEX MORGAN\nSkills\nJavaScript\nHOBBIES\nPython hiking club\nReferences\nJava expert",
    );
    expect(r.candidate.skills?.upsert?.map((s) => s.name)).toEqual([
      "JavaScript",
    ]);
  });
  it("keeps uncertain documents eligible for review and bounds input", () => {
    expect(
      assessTextQuality("\uFFFD".repeat(100) + " word ".repeat(100)).usable,
    ).toBe(false);
    expect(parse("ALEX MORGAN").warnings).toContain("SPARSE_TEXT");
    expect(() => parse("x".repeat(200001))).toThrow("limit");
  });
  it("rejects unsafe profile-link schemes and retains safe original summary text", () => {
    const r = parse(
      "ALEX MORGAN\nPortfolio: javascript:https://example.com\nWebsite: data:https://example.com\nSummary\nCandidate supplied text, without embellishment.",
    );
    expect(r.candidate.links).toBeUndefined();
    expect(r.candidate.profile?.summary).toBe(
      "Candidate supplied text, without embellishment.",
    );
  });
  it("bounds large structured output and retains useful sections for review", () => {
    const r = parse(
      "ALEX MORGAN\nSkills\nPython\nProjects\n" +
        Array.from(
          { length: 110 },
          (_, i) => `Project: Example ${i}\nTechnologies: Python`,
        ).join("\n"),
    );
    expect(r.candidate.skills?.upsert?.[0].name).toBe("Python");
    expect(r.candidate.projects?.upsert?.length).toBeLessThan(100);
    expect(r.warnings).toContain("STRUCTURED_OUTPUT_TRUNCATED");
  });
});
