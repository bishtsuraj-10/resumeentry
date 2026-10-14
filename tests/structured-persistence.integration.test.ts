import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { isolatedDatabase } from "./helpers/isolated-db";
import {
  claimResume,
  finalizeResume,
  cancelBatch,
  saveReview,
} from "../lib/processing";
import {
  extractStructuredResume,
  LocalResumeParser,
} from "../lib/resume-parser";
import { patchCandidate, readCandidate } from "../lib/candidate-data";
import { runResumeJob } from "../lib/resume-worker";
import { corpus } from "./fixtures/m3-corpus";
const url = process.env.M3_TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
describe.skipIf(!url)(
  "structured extraction fenced PostgreSQL persistence",
  () => {
    beforeAll(async () => {
      database = await isolatedDatabase(url!);
    }, 30000);
    afterAll(async () => {
      await database?.cleanup();
    });
    const db = () => database.db;
    async function resume(batchId?: string) {
      return db().resume.create({
        data: {
          fileName: "synthetic.pdf",
          filePath: randomUUID(),
          fileType: "pdf",
          fileSize: BigInt(1),
          fileHash: randomUUID(),
          batchId,
        },
      });
    }
    const parsed = () =>
      extractStructuredResume(corpus[0].text, { asOf: new Date("2026-10-01") });
    const finalize = (id: string, token: string, result = parsed()) =>
      finalizeResume(db(), id, token, result.basic, {
        parserVersion: result.parserVersion,
        startedAt: new Date(),
        structured: result,
      });
    it("persists every supported section, relationships, private evidence and version", async () => {
      const r = await resume(),
        claim = await claimResume(db(), r.id, 0);
      expect(await finalize(r.id, claim!.claimToken!)).toBe(true);
      const read = await readCandidate(db(), r.id);
      expect(read?.candidate?.verifiedAt).toBeNull();
      expect(read?.candidate?.summary).toBe(
        "Builds web applications for internal operations.",
      );
      expect(read?.candidate?.skills).toHaveLength(6);
      expect(read?.candidate?.employment).toHaveLength(1);
      expect(read?.candidate?.education).toHaveLength(1);
      expect(read?.candidate?.projects[0].skills).toHaveLength(2);
      expect(read?.candidate?.certifications).toHaveLength(1);
      expect(read?.candidate?.additional).toHaveLength(2);
      const run = await db().extractionRun.findFirstOrThrow({
        where: { resumeId: r.id },
        include: { evidence: true },
      });
      expect(run.parserVersion).toBe("local-comprehensive-v1.2");
      expect(run.method).toBe("LOCAL");
      expect(
        run.evidence.some((e) =>
          e.fieldPath.startsWith(
            "employment." + read!.candidate!.employment[0].id,
          ),
        ),
      ).toBe(true);
      expect(
        run.evidence
          .filter((e) => !e.fieldPath.startsWith("basic."))
          .every((e) => e.verifiedAt === null),
      ).toBe(true);
    });
    it("repeated delivery/finalization cannot duplicate structured entries", async () => {
      const r = await resume();
      const [a, b] = await Promise.all([
        claimResume(db(), r.id, 0),
        claimResume(db(), r.id, 0),
      ]);
      const claim = a ?? b;
      expect(await finalize(r.id, claim!.claimToken!)).toBe(true);
      expect(await finalize(r.id, claim!.claimToken!)).toBe(false);
      expect(
        await db().candidateEmployment.count({ where: { resumeId: r.id } }),
      ).toBe(1);
      expect(
        await db().extractionRun.count({ where: { resumeId: r.id } }),
      ).toBe(1);
    });
    it("rejects an expired owner without writing any candidate/run", async () => {
      const r = await resume(),
        claim = await claimResume(db(), r.id, 0);
      await db().resume.update({
        where: { id: r.id },
        data: { leaseUntil: new Date(0) },
      });
      expect(await finalize(r.id, claim!.claimToken!)).toBe(false);
      expect(
        await db().candidateProfile.count({ where: { resumeId: r.id } }),
      ).toBe(0);
      const fresh = await claimResume(db(), r.id, 0);
      expect(await finalize(r.id, fresh!.claimToken!)).toBe(true);
      expect(await finalize(r.id, claim!.claimToken!)).toBe(false);
    });
    it("preserves edits and explicit deletions made while extraction is running", async () => {
      const r = await resume(),
        claim = await claimResume(db(), r.id, 0);
      await patchCandidate(db(), r.id, "synthetic", {
        expectedRevision: 0,
        profile: { summary: "Human supplied correction" },
        employment: { upsert: [{ employer: "Human employer" }] },
      });
      const entry = await db().candidateEmployment.findFirstOrThrow({
        where: { resumeId: r.id },
      });
      await patchCandidate(db(), r.id, "synthetic", {
        expectedRevision: 1,
        employment: { remove: [entry.id] },
      });
      expect(await finalize(r.id, claim!.claimToken!)).toBe(true);
      const read = await readCandidate(db(), r.id);
      expect(read?.candidate?.summary).toBe("Human supplied correction");
      expect(read?.candidate?.employment).toEqual([]);
      expect(read?.candidate?.revision).toBe(2);
      expect(
        await db().candidateEvidence.count({
          where: {
            run: { resumeId: r.id, method: "LOCAL" },
            fieldPath: { startsWith: "observed.employment." },
          },
        }),
      ).toBeGreaterThan(0);
    });
    it("protects legacy four-field review by revoking the processing claim", async () => {
      const r = await resume(),
        claim = await claimResume(db(), r.id, 0);
      await saveReview(db(), r.id, "synthetic", {
        name: "Verified Name",
        email: "verified@example.com",
        phone: "+919876543210",
        designation: "Human Title",
      });
      expect(await finalize(r.id, claim!.claimToken!)).toBe(false);
      expect(
        await db().candidateProfile.count({ where: { resumeId: r.id } }),
      ).toBe(0);
    });
    it("rolls back basic status, structured writes, provenance and counters together", async () => {
      const batch = await db().processingBatch.create({
        data: { name: "Synthetic rollback batch", status: "PROCESSING" },
      });
      const r = await resume(batch.id),
        claim = await claimResume(db(), r.id, 0);
      await db().$executeRawUnsafe(
        `CREATE FUNCTION reject_m3_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`,
      );
      await db().$executeRawUnsafe(
        `CREATE TRIGGER reject_m3 BEFORE INSERT ON "CandidateEvidence" FOR EACH ROW WHEN (NEW."fieldPath" NOT LIKE 'basic.%') EXECUTE FUNCTION reject_m3_evidence()`,
      );
      try {
        await expect(finalize(r.id, claim!.claimToken!)).rejects.toThrow();
      } finally {
        await db().$executeRawUnsafe(
          `DROP TRIGGER reject_m3 ON "CandidateEvidence"`,
        );
        await db().$executeRawUnsafe(`DROP FUNCTION reject_m3_evidence()`);
      }
      expect(
        (await db().resume.findUniqueOrThrow({ where: { id: r.id } })).status,
      ).toBe("PROCESSING");
      expect(
        await db().candidateProfile.count({ where: { resumeId: r.id } }),
      ).toBe(0);
      expect(
        await db().resumeExtraction.count({ where: { resumeId: r.id } }),
      ).toBe(0);
      expect(
        (
          await db().processingBatch.findUniqueOrThrow({
            where: { id: batch.id },
          })
        ).processedFiles,
      ).toBe(0);
      expect(
        await db().extractionRun.count({ where: { resumeId: r.id } }),
      ).toBe(0);
    });
    it("worker extracts a real document once and never invokes configured remote AI", async () => {
      const filePath = path.join(process.cwd(), "tests/fixtures/m3/table.docx"),
        bytes = await readFile(filePath);
      const r = await db().resume.create({
        data: {
          fileName: "synthetic.docx",
          filePath,
          fileType: "docx",
          fileHash: createHash("sha256").update(bytes).digest("hex"),
          fileSize: BigInt(bytes.length),
        },
      });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("No remote parsing"));
      vi.stubEnv("AI_PARSING_ENABLED", "true");
      vi.stubEnv("AI_PROVIDER", "synthetic");
      vi.stubEnv("AI_API_KEY", "synthetic");
      vi.stubEnv("AI_API_URL", "https://example.invalid");
      try {
        expect(await runResumeJob(db(), { resumeId: r.id })).toBe("completed");
        expect(await runResumeJob(db(), { resumeId: r.id })).toBe("skipped");
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        vi.unstubAllEnvs();
      }
      expect(
        await db().candidateEmployment.count({ where: { resumeId: r.id } }),
      ).toBe(1);
      await db().resume.delete({ where: { id: r.id } });
    });
    it("cancellation during document extraction prevents finalization", async () => {
      const batch = await db().processingBatch.create({
        data: { name: "Synthetic M3 batch", status: "PROCESSING" },
      });
      const filePath = path.join(process.cwd(), "tests/fixtures/m3/table.docx"),
        bytes = await readFile(filePath);
      const r = await db().resume.create({
        data: {
          batchId: batch.id,
          fileName: "synthetic.docx",
          filePath,
          fileType: "docx",
          fileHash: createHash("sha256").update(bytes).digest("hex"),
          fileSize: BigInt(bytes.length),
        },
      });
      const spy = vi
        .spyOn(LocalResumeParser.prototype, "extractText")
        .mockImplementationOnce(async () => {
          await cancelBatch(db(), batch.id, "synthetic");
          return {
            text: corpus[0].text,
            usedOcr: false,
            ocrPages: 0,
            pageCount: 1,
            warnings: [],
            durationMs: 1,
          };
        });
      try {
        expect(await runResumeJob(db(), { resumeId: r.id })).toBe("skipped");
      } finally {
        spy.mockRestore();
      }
      expect(
        (await db().resume.findUniqueOrThrow({ where: { id: r.id } })).status,
      ).toBe("CANCELLED");
      expect(
        await db().candidateProfile.count({ where: { resumeId: r.id } }),
      ).toBe(0);
    });
    it("concurrent workers share a canonical taxonomy without duplicate associations", async () => {
      const records = await Promise.all([resume(), resume(), resume()]);
      const claims = await Promise.all(
        records.map((r) => claimResume(db(), r.id, 0)),
      );
      await Promise.all(
        records.map((r, i) => finalize(r.id, claims[i]!.claimToken!)),
      );
      expect(
        await db().skill.count({ where: { normalizedName: "javascript" } }),
      ).toBe(1);
      for (const r of records)
        expect(
          await db().resumeSkill.count({ where: { resumeId: r.id } }),
        ).toBe(6);
    });
  },
);
