import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractStructuredResume } from "../lib/resume-parser";
import { reviewDecision } from "../lib/resume-parser/review-policy";

const retired = ["firstName", "lastName", "additionalEmails", "additionalPhones", "city", "region", "country", "otherEmails"];
const header = "Synthetic Candidate\nSoftware Engineer\nprimary@example.test\n+91 98765 43210";
describe("retained candidate representation", () => {
  it("removes exactly the approved schema fields and keeps internal fields and relations", async () => {
    const schema = await readFile("prisma/schema.prisma", "utf8");
    for (const field of retired) expect(schema).not.toMatch(new RegExp(`^\\s+${field}\\s`, "m"));
    for (const field of ["normalizedPhone", "countryCode", "headline", "objective", "totalExperienceMonths", "revision", "locationText", "employment", "education", "skills", "projects", "certifications", "links", "additional", "extractionRuns"])
      expect(schema).toMatch(new RegExp(`^\\s+${field}\\s`, "m"));
  });
  it("retains only primary contacts and emits no retired parser properties or new retired evidence paths", () => {
    const result = extractStructuredResume(header + "\nOther Email: secondary@example.test\nAlternate Phone: +1 415 555 0100");
    expect(result.basic).toMatchObject({ name: "Synthetic Candidate", email: "primary@example.test", normalizedPhone: "+919876543210", countryCode: "+91" });
    for (const field of retired) {
      expect(result.basic).not.toHaveProperty(field);
      expect(result.candidate.profile ?? {}).not.toHaveProperty(field);
      expect(result.evidence.some(proof => proof.fieldPath === "profile." + field || proof.fieldPath === "basic." + field)).toBe(false);
    }
  });
  it.each([
    ["City: Dehradun\nState: Uttarakhand\nCountry: India", "Dehradun, Uttarakhand, India"],
    ["City: Paris", "Paris"],
    ["City: 東京都\nCountry: 日本", "東京都, 日本"],
    ["City: Paris\nCountry: Unknown", "Paris"],
    ["Location: Paris, France\nCity: Paris\nCountry: France", "Paris, France"],
  ])("stores recognized location information in locationText: %s", (input, locationText) => {
    expect(extractStructuredResume(header + "\n" + input).candidate.profile?.locationText).toBe(locationText);
  });
  it("does not use employer or institution locations as candidate location", () => {
    const result = extractStructuredResume(header + "\nExperience\nSoftware Engineer at Synthetic Company\nCity: Paris\nEducation\nInstitution: Synthetic University\nCountry: France");
    expect(result.candidate.profile?.locationText).toBeUndefined();
  });
  it("requires retained location even if a stale caller supplies deleted components", () => {
    const result = extractStructuredResume(header + "\nSummary\nBuilds applications.\nSkills\nTypeScript\nGitHub: https://example.test/code");
    result.basic.overallConfidence = 0.99;
    const candidate = { locationText: null, city: "Paris", region: null, country: "France", summary: "Builds applications.", skills: [{ skill: { canonicalName: "TypeScript" } }], links: [{ url: "https://example.test/code" }] };
    expect(reviewDecision(result.basic, candidate)).toMatchObject({ requiresReview: true, reasons: expect.arrayContaining(["MISSING_LOCATION"]) });
  });
});
