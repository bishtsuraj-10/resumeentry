import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ResumeStatus } from "@prisma/client";
import { isolatedDatabase } from "./helpers/isolated-db";
import { claimResume, finalizeResume, saveReview } from "../lib/processing";
import { patchCandidate } from "../lib/candidate-data";
import { extractStructuredResume } from "../lib/resume-parser";

const url = process.env.M3_TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
describe.skipIf(!url)("automatic completion against persisted PostgreSQL candidate data", () => {
  beforeAll(async () => { database = await isolatedDatabase(url!); }, 30000);
  afterAll(async () => { await database?.cleanup(); });
  const db = () => database.db;
  const parsed = () => {
    const result = extractStructuredResume("Alex Smith\nSoftware Engineer\nalex@example.com\n+919876543210");
    result.basic.email = randomUUID() + "@example.com";
    result.basic.phone = "+919876543210";
    result.basic.normalizedPhone = null; // Unique email is the duplicate identity in this fixture.
    result.basic.overallConfidence = 0.75;
    result.candidate = {
      profile: { locationText: "Bengaluru", summary: "Builds applications for internal operations." },
      skills: { upsert: [{ name: "TypeScript" }] },
      links: { upsert: [{ type: "WEBSITE", url: "https://example.com/profile" }] },
    };
    result.warnings = ["UNRESOLVED_EMPLOYMENT", "LOW_OCR_CONFIDENCE"];
    return result;
  };
  async function resume(status: ResumeStatus = "PENDING") {
    return db().resume.create({ data: { fileName: "synthetic.pdf", filePath: randomUUID(), fileHash: randomUUID(), fileType: "pdf", fileSize: BigInt(1), status } });
  }
  const finalize = (id: string, token: string, result = parsed()) => finalizeResume(db(), id, token, result.basic, { parserVersion: result.parserVersion, startedAt: new Date(), structured: result });
  it.each([
    ["complete at 75", 0.75, null, "COMPLETED"],
    ["complete below 75", 0.7499, null, "REVIEW"],
    ["no links at 85", 0.85, "links", "COMPLETED"],
    ["no links below 85", 0.8499, "links", "REVIEW"],
    ["no location", 0.99, "location", "REVIEW"],
    ["no designation", 0.99, "designation", "REVIEW"],
    ["no skills", 0.99, "skills", "REVIEW"],
    ["no summary", 0.99, "summary", "REVIEW"],
    ["placeholder summary", 0.99, "placeholder", "REVIEW"],
    ["invalid link", 0.99, "invalid-link", "REVIEW"],
    ["placeholder name", 0.99, "invalid-name", "REVIEW"],
    ["invalid email", 0.99, "invalid-email", "REVIEW"],
    ["invalid phone", 0.99, "invalid-phone", "REVIEW"],
    ["placeholder designation", 0.99, "invalid-designation", "REVIEW"],
    ["blank location", 0.99, "invalid-location", "REVIEW"],
    ["placeholder skill", 0.99, "invalid-skill", "REVIEW"],
  ])("%s", async (_label, confidence, missing, status) => {
    const r = await resume(), claim = await claimResume(db(), r.id, 0), result = parsed();
    result.basic.overallConfidence = Number(confidence);
    if (missing === "links") delete result.candidate.links;
    if (missing === "location") delete result.candidate.profile!.locationText;
    if (missing === "designation") result.basic.designation = null;
    if (missing === "skills") delete result.candidate.skills;
    if (missing === "summary") delete result.candidate.profile!.summary;
    if (missing === "placeholder") result.candidate.profile!.summary = "Not Provided";
    if (missing === "invalid-link") result.candidate.links!.upsert![0].url = "ftp://example.com";
    if (missing === "invalid-name") result.basic.name = "Unknown";
    if (missing === "invalid-email") result.basic.email = "invalid";
    if (missing === "invalid-phone") result.basic.phone = "123";
    if (missing === "invalid-designation") result.basic.designation = "N/A";
    if (missing === "invalid-location") result.candidate.profile!.locationText = "  ";
    if (missing === "invalid-skill") result.candidate.skills!.upsert![0].name = "Not Provided";
    expect(await finalize(r.id, claim!.claimToken!, result)).toBe(true);
    const saved = await db().resume.findUniqueOrThrow({ where: { id: r.id }, include: { extraction: true, candidate: { include: { skills: true, links: true, education: true, employment: true } } } });
    expect(saved.status).toBe(status);
    expect(saved.extraction!.requiresReview).toBe(status === "REVIEW");
    expect(saved.extraction!.overallConfidence).toBe(confidence);
    expect(saved.extraction!.reviewedAt).toBeNull();
    expect(saved.candidate!.dateOfBirth).toBeNull();
    expect(saved.candidate!.education).toEqual([]);
    expect(saved.candidate!.employment).toEqual([]);
    const pending = await db().resume.findMany({ where: { id: r.id, status: "REVIEW" } });
    expect(pending).toHaveLength(status === "REVIEW" ? 1 : 0);
    expect(await db().candidateEvidence.findFirst({ where: { run: { resumeId: r.id }, fieldPath: "review.automatic" } })).toBeTruthy();
    expect(await finalize(r.id, claim!.claimToken!, result)).toBe(false);
    expect(await db().extractionRun.count({ where: { resumeId: r.id } })).toBe(1);
    expect(await db().candidateEvidence.count({ where: { run: { resumeId: r.id }, fieldPath: "review.automatic" } })).toBe(1);
  });
  it("preserves manual edits and deletion intent and evaluates them instead of transient output", async () => {
    const r = await resume(), claim = await claimResume(db(), r.id, 0), result = parsed();
    await patchCandidate(db(), r.id, "synthetic", { expectedRevision: 0, profile: { locationText: "Paris", summary: "Human corrected summary" }, skills: { upsert: [{ name: "Rust" }] } });
    result.basic.overallConfidence = 0.85;
    expect(await finalize(r.id, claim!.claimToken!, result)).toBe(true);
    const saved = await db().resume.findUniqueOrThrow({ where: { id: r.id }, include: { candidate: { include: { skills: { include: { skill: true } }, links: true } } } });
    expect(saved).toMatchObject({ status: "COMPLETED", candidate: { locationText: "Paris", summary: "Human corrected summary", links: [] } });
    expect(saved.candidate!.skills.map(s => s.skill.canonicalName)).toEqual(["Rust"]);
    const r2 = await resume(), claim2 = await claimResume(db(), r2.id, 0);
    await patchCandidate(db(), r2.id, "synthetic", { expectedRevision: 0, profile: { summary: "Human supplied summary" } });
    const result2 = parsed();
    result2.basic.overallConfidence = 0.99;
    expect(await finalize(r2.id, claim2!.claimToken!, result2)).toBe(true);
    expect((await db().resume.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("REVIEW");
    expect((await db().resumeExtraction.findUniqueOrThrow({ where: { resumeId: r2.id } })).requiresReview).toBe(true);
  });
  it("cannot overwrite human identity corrections or downgrade a manual completion", async () => {
    const r = await resume(), claim = await claimResume(db(), r.id, 0);
    await saveReview(db(), r.id, "synthetic", { name: "Human Name", email: "human@example.com", phone: null, designation: "Human Title" });
    expect(await finalize(r.id, claim!.claimToken!)).toBe(false);
    expect(await claimResume(db(), r.id, 0)).toBeNull();
    expect(await db().resume.findUniqueOrThrow({ where: { id: r.id }, include: { extraction: true } })).toMatchObject({ status: "COMPLETED", extraction: { name: "Human Name", designation: "Human Title" } });
    expect(await db().candidateEvidence.count({ where: { run: { resumeId: r.id }, fieldPath: "review.automatic" } })).toBe(0);
  });
  it.each(["FAILED", "DUPLICATE", "CANCELLED", "COMPLETED"] as const)("protects %s from automatic finalization", async status => {
    const r = await resume(status);
    expect(await finalize(r.id, "stale-token")).toBe(false);
    expect(await claimResume(db(), r.id, 0)).toBeNull();
    expect((await db().resume.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(status);
    expect(await db().extractionRun.count({ where: { resumeId: r.id } })).toBe(0);
  });
});
