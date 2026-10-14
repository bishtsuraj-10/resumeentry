import { describe, expect, it } from "vitest";
import { candidatePatchSchema, normalizeSkillName, partialDateSchema, safeUrlSchema } from "../lib/candidate-validation";
import { readCandidateBody } from "../lib/candidate-http";

describe("candidate validation", () => {
  it("accepts unknown fields as null and empty collections", () => {
    expect(candidatePatchSchema.parse({ expectedRevision: 0, profile: {  summary: null, employmentPreferences: [] } }).profile?.summary).toBeNull();
  });
  it("preserves year-only, month-year and original date text", () => {
    expect(partialDateSchema.parse({ year: 2021 })).toEqual({ year: 2021 });
    expect(partialDateSchema.parse({ year: 2021, month: 6 })).toEqual({ year: 2021, month: 6 });
    expect(partialDateSchema.parse({ text: "Summer 2020" })).toEqual({ text: "Summer 2020" });
  });
  it("rejects missing date components and invalid calendar days", () => {
    for (const value of [{ month: 1 }, { year: 2020, day: 4 }, { year: 2021, month: 2, day: 29 }, { year: 2020, month: 13 }, {}])
      expect(partialDateSchema.safeParse(value).success).toBe(false);
    expect(partialDateSchema.safeParse({ year: 2020, month: 2, day: 29 }).success).toBe(true);
  });
  it("normalizes safe URLs and rejects unsafe schemes and embedded credentials", () => {
    expect(safeUrlSchema.parse(" HTTPS://EXAMPLE.COM/path#section ")).toBe("https://example.com/path");
    for (const url of ["javascript:alert(1)", "data:text/plain,test", "file:///private", "//example.com", "https://user:password@example.com"])
      expect(safeUrlSchema.safeParse(url).success).toBe(false);
  });
  it("rejects mass assignment of processing, confidence and verification fields", () => {
    for (const field of ["status", "resumeId", "claimToken", "parserVersion", "reviewedAt"])
      expect(candidatePatchSchema.safeParse({ expectedRevision: 0, [field]: "injected", profile: { locationText: "Example" } }).success).toBe(false);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, employment: { upsert: [{ confidence: 1 }] } }).success).toBe(false);
  });
  it("normalizes primary email and validates international primary phones", () => {
    const result = candidatePatchSchema.parse({ expectedRevision: 0, basic: { email: "TEST@EXAMPLE.COM", phone: "+91 98765 43210" } });
    expect(result.basic?.email).toBe("test@example.com");
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, basic: { phone: "9876543210" } }).success).toBe(false);
  });
  it.each(["firstName", "lastName", "additionalEmails", "additionalPhones", "city", "region", "country"])("rejects retired profile field %s", field => {
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, profile: { [field]: null, locationText: "Example" } }).success).toBe(false);
  });
  it("rejects retired otherEmails in primary corrections", () => {
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, basic: { name: "Synthetic Name", otherEmails: [] } }).success).toBe(false);
  });
  it("requires explicitly supplied valid DOB and bounded experience", () => {
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, profile: { dateOfBirth: "2001-02-29" } }).success).toBe(false);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, profile: { dateOfBirth: "2000-02-29", totalExperienceMonths: 36 } }).success).toBe(true);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, profile: { totalExperienceMonths: -1 } }).success).toBe(false);
  });
  it("rejects conflicting entry operations, duplicate ordering and empty edits", () => {
    for (const changes of [{ expectedRevision: 0 }, { expectedRevision: 0, profile: undefined }, { expectedRevision: 0, profile: {} },
      { expectedRevision: 0, employment: { upsert: [{ id: "a" }], remove: ["a"] } },
      { expectedRevision: 0, education: { upsert: [{ position: 0 }, { position: 0 }] } }])
      expect(candidatePatchSchema.safeParse(changes).success).toBe(false);
  });
  it("bounds nested entries, evidence and additional JSON", () => {
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, employment: { upsert: Array.from({ length: 101 }, () => ({})) } }).success).toBe(false);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, profile: { locationText: "Example", evidence: [{ text: "x".repeat(501) }] } }).success).toBe(false);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, additional: { upsert: [{ type: "AWARD", details: { arbitrary: {} } }] } }).success).toBe(false);
    expect(candidatePatchSchema.safeParse({ expectedRevision: 0, projects: { upsert: Array.from({ length: 5 }, () => ({
      skills: Array.from({ length: 50 }, (_, i) => ({ name: "Skill " + i })),
    })) } }).success).toBe(false);
  });
  it("normalizes taxonomy names without losing technology punctuation", () => {
    expect(normalizeSkillName("  Node.js  ")).toBe("node.js");
    expect(normalizeSkillName("Ｃ＋＋")).toBe("c++");
    expect(normalizeSkillName("C#")).not.toBe(normalizeSkillName("C++"));
  });
  it("limits streamed request bodies even without content-length", async () => {
    const request = new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(256 * 1024) }) });
    await expect(readCandidateBody(request)).rejects.toMatchObject({ status: 413 });
  });
});
