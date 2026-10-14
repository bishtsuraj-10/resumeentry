import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedDatabase } from "./helpers/isolated-db";
import { patchCandidate, readCandidate, readCandidateProvenance, readRunEvidence } from "../lib/candidate-data";
import { claimResume, finalizeResume, saveReview } from "../lib/processing";
import { extractResumeFields } from "../lib/resume-parser";

const url = process.env.M2_TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
describe.skipIf(!url)("candidate data PostgreSQL integration", () => {
  beforeAll(async () => { database = await isolatedDatabase(url!); }, 30000);
  afterAll(async () => { await database?.cleanup(); });
  const db = () => database.db;
  async function resume() {
    return db().resume.create({ data: { fileName: "synthetic.pdf", filePath: randomUUID(), fileSize: BigInt(1), fileType: "pdf", fileHash: randomUUID() } });
  }
  const uniqueSkill = () => "Skill-" + randomUUID();
  const patch = (id: string, input: unknown) => patchCandidate(db(), id, "synthetic-actor", input);

  it("migrates legacy basic and verified extraction without backfilling profiles", async () => {
    const read = await readCandidate(db(), "legacy-m2");
    expect(read).toMatchObject({ revision: 0, candidate: null, basic: { name: "Legacy Candidate", email: "legacy@example.com" } });
    expect(read?.basic?.reviewedAt).toBeTruthy();
    expect(await db().resumeExtraction.findUnique({ where: { resumeId: "legacy-m2" } })).toMatchObject({ nameConfidence: 0.8 });
  });
  it("round trips identity and professional details without generating missing information", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { firstName: "Synthetic", lastName: null, city: "Example City", region: "Example Region",
      country: "Example Country", locationText: "Originally supplied", dateOfBirth: "2000-02-29", headline: "Supplied headline",
      summary: "Candidate supplied summary", objective: null, totalExperienceMonths: 36, noticePeriod: "30 days",
      employmentPreferences: ["Remote"], additionalEmails: ["EXTRA@EXAMPLE.COM", "extra@example.com"], additionalPhones: ["+91 98765 43210"] } });
    const read = await readCandidate(db(), r.id);
    expect(read?.basic).toBeNull();
    expect(read?.candidate).toMatchObject({ revision: 1, firstName: "Synthetic", lastName: null, summary: "Candidate supplied summary", objective: null,
      additionalEmails: ["extra@example.com"], totalExperienceMonths: 36, additionalPhones: [{ originalText: "+91 98765 43210", normalizedPhone: "+919876543210", countryCode: "+91" }] });
    expect(read?.candidate?.dateOfBirth?.toISOString().slice(0, 10)).toBe("2000-02-29");
  });
  it("stores multiple ordered employment records and lossless partial dates", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, employment: { upsert: [
      { position: 1, employer: "Older employer", startDate: { year: 2018 }, endDate: { year: 2020, month: 6 } },
      { position: 0, employer: "Current employer", designation: "Engineer", isCurrent: true, startDate: { year: 2020, month: 7 },
        responsibilities: ["Supplied responsibility"], achievements: ["Supplied achievement"] },
    ] } });
    const read = await readCandidate(db(), r.id);
    expect(read?.candidate?.employment.map((e) => e.employer)).toEqual(["Current employer", "Older employer"]);
    expect(read?.candidate?.employment[1]).toMatchObject({ startYear: 2018, startMonth: null, startDay: null, endYear: 2020, endMonth: 6, endDay: null });
  });
  it("stores multiple education entries with optional grade scales and dates", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, education: { upsert: [
      { degree: "BSc", institution: "Synthetic University", fieldOfStudy: "Computing", startDate: { year: 2016 }, endDate: { year: 2019 }, grade: "8.1", gradeScale: "10" },
      { degree: "Certificate", institution: null, startDate: { text: "Summer 2020" }, description: null },
    ] } });
    const entries = (await readCandidate(db(), r.id))!.candidate!.education;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ grade: "8.1", gradeScale: "10" });
    expect(entries[1]).toMatchObject({ startYear: null, startText: "Summer 2020", institution: null });
  });
  it("deduplicates canonical skills and aliases while retaining occurrence evidence", async () => {
    const r = await resume(), name = uniqueSkill(), alias = uniqueSkill();
    await patch(r.id, { expectedRevision: 0, skills: { upsert: [
      { name, aliases: [alias], category: "Technical", originalText: "Original canonical mention", evidence: [{ text: "Canonical occurrence", sourceSection: "Skills" }] },
      { name: alias.toUpperCase(), originalText: "Alias mention", evidence: [{ text: "Second occurrence", sourceSection: "Project" }] },
    ] } });
    const read = await readCandidate(db(), r.id);
    expect(read?.candidate?.skills).toHaveLength(1);
    expect(read?.candidate?.skills[0].confidence).toBeNull();
    expect(read?.candidate?.skills[0].skill.canonicalName).toBe(name);
    const runs = await readCandidateProvenance(db(), r.id);
    expect(runs[0].evidence.map((e) => e.text)).toEqual(expect.arrayContaining(["Canonical occurrence", "Second occurrence", "Original canonical mention", "Alias mention"]));
  });
  it("rejects alias collisions and rolls back the whole candidate edit", async () => {
    const r = await resume(), name = uniqueSkill(), alias = uniqueSkill();
    await patch(r.id, { expectedRevision: 0, skills: { upsert: [{ name, aliases: [alias] }] } });
    const other = await resume();
    await expect(patch(other.id, { expectedRevision: 0, profile: { city: "Must roll back" }, skills: { upsert: [{ name: uniqueSkill(), aliases: [alias] }] } })).rejects.toMatchObject({ status: 409 });
    expect(await db().candidateProfile.findUnique({ where: { resumeId: other.id } })).toBeNull();
    expect(await db().extractionRun.count({ where: { resumeId: other.id } })).toBe(0);
  });
  it("handles concurrent canonical skill creation across candidates", async () => {
    const r1 = await resume(), r2 = await resume(), name = uniqueSkill();
    const results = await Promise.allSettled([patch(r1.id, { expectedRevision: 0, skills: { upsert: [{ name }] } }), patch(r2.id, { expectedRevision: 0, skills: { upsert: [{ name: name.toUpperCase() }] } })]);
    // A conflict response is safe and can be retried; taxonomy must never duplicate.
    for (let i = 0; i < results.length; i++) if (results[i].status === "rejected") await patch(i ? r2.id : r1.id, { expectedRevision: 0, skills: { upsert: [{ name }] } });
    const skills = await db().resumeSkill.findMany({ where: { resumeId: { in: [r1.id, r2.id] } } });
    expect(new Set(skills.map((s) => s.skillId)).size).toBe(1);
    expect(skills).toHaveLength(2);
  });
  it("stores projects with normalized technology relationships and certifications", async () => {
    const r = await resume(), name = uniqueSkill();
    await patch(r.id, { expectedRevision: 0,
      projects: { upsert: [{ name: "Synthetic Project", role: "Developer", description: "Supplied text", skills: [{ name }, { name: name.toUpperCase() }],
        startDate: { year: 2024 }, url: "https://EXAMPLE.COM/project#section" }] },
      certifications: { upsert: [{ name: "Synthetic Certificate", issuer: "Synthetic Issuer", credentialId: "ID-1", issueDate: { year: 2024, month: 3 },
        expiryDate: null, url: "https://example.com/credential" }] } });
    const candidate = (await readCandidate(db(), r.id))!.candidate!;
    expect(candidate.projects[0].skills).toHaveLength(1);
    expect(candidate.projects[0].url).toBe("https://example.com/project");
    expect(candidate.certifications[0]).toMatchObject({ issueYear: 2024, issueMonth: 3, issueDay: null, expiryYear: null, issuer: "Synthetic Issuer" });
  });
  it("persists safe professional links and typed additional sections", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, links: { upsert: [{ type: "GITHUB", url: "https://github.com/synthetic" }, { type: "PORTFOLIO", url: "https://example.com" }] },
      additional: { upsert: [{ type: "LANGUAGE", title: "English", details: { proficiency: "Stated fluent" } },
        { type: "VOLUNTEERING", title: "Synthetic volunteering", details: { organization: "Synthetic Org", startDate: { year: 2022 } } }] } });
    const candidate = (await readCandidate(db(), r.id))!.candidate!;
    expect(candidate.links).toHaveLength(2);
    expect(candidate.additional).toHaveLength(2);
    expect(candidate.links[1].verifiedAt).toBeTruthy();
  });
  it("preserves omitted fields and unrelated relations on partial edits", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { summary: "Keep summary", city: "Old City" }, employment: { upsert: [{ employer: "Keep employer" }, { employer: "Also keep" }] },
      education: { upsert: [{ degree: "Keep degree" }] } });
    const before = (await readCandidate(db(), r.id))!.candidate!;
    await patch(r.id, { expectedRevision: 1, profile: { city: "New City" }, employment: { upsert: [{ id: before.employment[0].id, designation: "New designation" }] } });
    const after = (await readCandidate(db(), r.id))!.candidate!;
    expect(after).toMatchObject({ summary: "Keep summary", city: "New City" });
    expect(after.employment.map((e) => e.employer)).toEqual(["Keep employer", "Also keep"]);
    expect(after.education).toHaveLength(1);
  });
  it("removes only explicit owned entries and preserves correction audit references", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, employment: { upsert: [{ employer: "Remove" }, { employer: "Keep" }] } });
    const id = (await readCandidate(db(), r.id))!.candidate!.employment[0].id;
    await patch(r.id, { expectedRevision: 1, employment: { remove: [id] } });
    expect((await readCandidate(db(), r.id))!.candidate!.employment.map((e) => e.employer)).toEqual(["Keep"]);
    const runs = await readCandidateProvenance(db(), r.id);
    expect(runs).toHaveLength(2);
    expect(runs[1].evidence[0].auditLogId).toBeTruthy();
  });
  it("rejects cross-candidate update and delete IDs without any partial write", async () => {
    const r1 = await resume(), r2 = await resume();
    await patch(r1.id, { expectedRevision: 0, education: { upsert: [{ degree: "Owned" }] } });
    const id = (await readCandidate(db(), r1.id))!.candidate!.education[0].id;
    for (const changes of [{ upsert: [{ id, degree: "Injected" }] }, { remove: [id] }]) {
      await expect(patch(r2.id, { expectedRevision: 0, profile: { city: "Injected" }, education: changes })).rejects.toMatchObject({ status: 404 });
      expect(await db().candidateProfile.findUnique({ where: { resumeId: r2.id } })).toBeNull();
    }
    expect((await readCandidate(db(), r1.id))!.candidate!.education[0].degree).toBe("Owned");
  });
  it("uses optimistic revisions to prevent lost concurrent corrections", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { city: "Original" } });
    const updates = await Promise.allSettled([patch(r.id, { expectedRevision: 1, profile: { city: "First" } }), patch(r.id, { expectedRevision: 1, profile: { city: "Second" } })]);
    expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await readCandidate(db(), r.id))!.revision).toBe(2);
  });
  it("permits only one concurrent first profile creation", async () => {
    const r = await resume();
    const updates = await Promise.allSettled([patch(r.id, { expectedRevision: 0, profile: { city: "First" } }), patch(r.id, { expectedRevision: 0, profile: { city: "Second" } })]);
    expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await readCandidate(db(), r.id))!.revision).toBe(1);
  });
  it("reorders existing records atomically without losing IDs", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, education: { upsert: [{ degree: "First" }, { degree: "Second" }] } });
    const entries = (await readCandidate(db(), r.id))!.candidate!.education;
    await patch(r.id, { expectedRevision: 1, education: { upsert: [{ id: entries[0].id, position: 1 }, { id: entries[1].id, position: 0 }] } });
    expect((await readCandidate(db(), r.id))!.candidate!.education.map((e) => e.degree)).toEqual(["Second", "First"]);
  });
  it("rejects impossible current-employment and reversed-date updates", async () => {
    const r = await resume();
    await expect(patch(r.id, { expectedRevision: 0, employment: { upsert: [{ isCurrent: true, endDate: { year: 2023 } }] } })).rejects.toMatchObject({ status: 422 });
    await expect(patch(r.id, { expectedRevision: 0, employment: { upsert: [{ startDate: { year: 2024 }, endDate: { year: 2023 } }] } })).rejects.toMatchObject({ status: 422 });
    expect(await db().candidateProfile.findUnique({ where: { resumeId: r.id } })).toBeNull();
  });
  it("M1 finalization preserves structured human changes and records local provenance", async () => {
    const r = await resume(), claim = await claimResume(db(), r.id, 0);
    await patch(r.id, { expectedRevision: 0, profile: { summary: "Human verified summary" }, skills: { upsert: [{ name: uniqueSkill() }] } });
    const before = (await readCandidate(db(), r.id))!.candidate!;
    expect(await finalizeResume(db(), r.id, claim!.claimToken!, extractResumeFields("Alex Smith\nSoftware Engineer\nlocal@example.com"), true)).toBe(true);
    const after = (await readCandidate(db(), r.id))!.candidate!;
    expect(after.summary).toBe(before.summary);
    expect(after.verifiedAt).toEqual(before.verifiedAt);
    expect(after.skills).toEqual(before.skills);
    const runs = await readCandidateProvenance(db(), r.id);
    expect(runs.map((r) => r.method)).toEqual(expect.arrayContaining(["HUMAN", "LOCAL"]));
    expect(runs.find((r) => r.method === "LOCAL")?.parserVersion).toBe("local-basic-v1");
  });
  it("existing four-field review preserves all structured relations and confidences", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { summary: "Keep" }, education: { upsert: [{ degree: "Keep" }] } });
    await saveReview(db(), r.id, "synthetic-actor", { name: "Human Name", email: "human@example.com", phone: null, normalizedPhone: null, countryCode: null, designation: "Supplied" });
    expect((await readCandidate(db(), r.id))!.candidate).toMatchObject({ summary: "Keep", education: [{ degree: "Keep" }] });
    const provenance = await readCandidateProvenance(db(), r.id);
    expect(provenance.find((r) => r.evidence.some((e) => e.fieldPath === "basic.name"))?.evidence[0].confidence).toBeNull();
  });
  it("does not leak evidence in standard reads and scopes provenance to its resume", async () => {
    const r = await resume(), other = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { city: "Example", evidence: [{ text: "Private synthetic evidence", sourceSection: "Contact", location: { page: 1 } }] } });
    expect(JSON.stringify(await readCandidate(db(), r.id))).not.toContain("Private synthetic evidence");
    expect(await readCandidateProvenance(db(), other.id)).toEqual([]);
    expect(JSON.stringify(await readCandidateProvenance(db(), r.id))).toContain("Private synthetic evidence");
  });
  it("cascades candidate data and provenance while preserving the shared taxonomy", async () => {
    const r = await resume(), name = uniqueSkill();
    await patch(r.id, { expectedRevision: 0, profile: { city: "Example" }, skills: { upsert: [{ name }] }, projects: { upsert: [{ name: "Owned", skills: [{ name }] }] },
      employment: { upsert: [{ employer: "Owned" }] }, education: { upsert: [{ degree: "Owned" }] }, certifications: { upsert: [{ name: "Owned" }] },
      links: { upsert: [{ type: "WEBSITE", url: "https://example.com/cascade" }] }, additional: { upsert: [{ type: "AWARD", title: "Owned" }] } });
    const runIds = (await readCandidateProvenance(db(), r.id)).map((r) => r.id);
    await db().resume.delete({ where: { id: r.id } });
    expect(await db().candidateProfile.findUnique({ where: { resumeId: r.id } })).toBeNull();
    expect(await db().candidateEvidence.count({ where: { runId: { in: runIds } } })).toBe(0);
    expect(await db().skill.findUnique({ where: { normalizedName: name.toLowerCase() } })).not.toBeNull();
  });
  it("enforces database confidence, partial-date and timestamp integrity", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, profile: { city: "Example" } });
    await expect(db().candidateEmployment.create({ data: { resumeId: r.id, position: 0, startMonth: 1 } })).rejects.toThrow();
    await expect(db().candidateEducation.create({ data: { resumeId: r.id, position: 0, confidence: 2 } })).rejects.toThrow();
    await expect(db().extractionRun.create({ data: { resumeId: r.id, method: "IMPORT", startedAt: new Date(1000), completedAt: new Date(0) } })).rejects.toThrow();
  });
  it("paginates evidence without losing access to later occurrences", async () => {
    const r = await resume(), other = await resume();
    const run = await db().extractionRun.create({ data: { resumeId: r.id, method: "IMPORT", parserVersion: "synthetic-v1", startedAt: new Date(),
      evidence: { create: Array.from({ length: 201 }, (_, i) => ({ fieldPath: "synthetic." + i, text: "Synthetic occurrence" })) } } });
    const preview = await readCandidateProvenance(db(), r.id);
    expect(preview[0].evidence).toHaveLength(100);
    expect(preview[0]._count.evidence).toBe(201);
    expect((await readRunEvidence(db(), r.id, run.id, 3))?.evidence).toHaveLength(1);
    expect(await readRunEvidence(db(), other.id, run.id)).toBeNull();
  });
  it("rejects structured writes to cancelled resumes and batches", async () => {
    const r = await resume();
    await db().resume.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
    await expect(patch(r.id, { expectedRevision: 0, profile: { city: "Injected" } })).rejects.toMatchObject({ status: 409 });
    const b = await db().processingBatch.create({ data: { name: "Synthetic cancelled", status: "CANCELLED" } });
    const other = await resume();
    await db().resume.update({ where: { id: other.id }, data: { batchId: b.id } });
    await expect(patch(other.id, { expectedRevision: 0, profile: { city: "Injected" } })).rejects.toMatchObject({ status: 409 });
  });
  it("retains prior machine confidence while recording human verification separately", async () => {
    const r = await resume();
    await patch(r.id, { expectedRevision: 0, employment: { upsert: [{ employer: "Original" }] } });
    const record = (await readCandidate(db(), r.id))!.candidate!.employment[0];
    await db().candidateEmployment.update({ where: { id: record.id }, data: { confidence: 0.72 } });
    await patch(r.id, { expectedRevision: 1, employment: { upsert: [{ id: record.id, employer: "Corrected" }] } });
    expect((await readCandidate(db(), r.id))!.candidate!.employment[0]).toMatchObject({ confidence: 0.72, employer: "Corrected" });
    expect((await readCandidateProvenance(db(), r.id))[0].evidence[0].confidence).toBeNull();
  });
  it("rolls back finalization if provenance cannot be stored and never duplicates successful runs", async () => {
    const r = await resume(), claim = await claimResume(db(), r.id, 0);
    const fields = extractResumeFields("Alex Smith\nSoftware Engineer\nrollback@example.com");
    await expect(finalizeResume(db(), r.id, claim!.claimToken!, fields, true, { parserVersion: "synthetic", startedAt: new Date(), method: "INVALID" as "LOCAL" })).rejects.toThrow();
    expect(await db().resume.findUnique({ where: { id: r.id } })).toMatchObject({ status: "PROCESSING", claimToken: claim!.claimToken });
    expect(await db().resumeExtraction.findUnique({ where: { resumeId: r.id } })).toBeNull();
    expect(await db().extractionRun.count({ where: { resumeId: r.id } })).toBe(0);
    expect(await finalizeResume(db(), r.id, claim!.claimToken!, fields, true)).toBe(true);
    expect(await finalizeResume(db(), r.id, claim!.claimToken!, fields, true)).toBe(false);
    expect(await db().extractionRun.count({ where: { resumeId: r.id } })).toBe(1);
  });
});
