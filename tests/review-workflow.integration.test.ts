import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedDatabase } from "./helpers/isolated-db";
import { patchCandidate, readCandidateProvenance } from "../lib/candidate-data";
const url = process.env.M2_TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
describe.skipIf(!url)("M3.1 revision-safe review workflow", () => {
  beforeAll(async () => {
    database = await isolatedDatabase(url!);
  }, 30000);
  afterAll(async () => {
    await database?.cleanup();
  });
  const db = () => database.db;
  async function resume() {
    return db().resume.create({
      data: {
        fileName: "synthetic.pdf",
        filePath: randomUUID(),
        fileHash: randomUUID(),
        fileSize: BigInt(1),
        fileType: "pdf",
        status: "REVIEW",
        extraction: {
          create: {
            name: "Synthetic Person",
            email: "synthetic@example.com",
            phone: "+1 512 555 0101",
            designation: "Engineer",
            overallConfidence: 0.94,
            requiresReview: true,
          },
        },
        candidate: {
          create: {
            revision: 4,
            summary: "Original summary",
            education: {
              create: {
                position: 0,
                degree: "Bachelor of Science",
                institution: "Synthetic College",
              },
            },
          },
        },
      },
    });
  }
  it("corrects only one basic field with a revision and preserves confidence and unrelated records", async () => {
    const r = await resume();
    await patchCandidate(db(), r.id, "synthetic-reviewer", {
      expectedRevision: 4,
      basic: { designation: "Mechanical Engineer" },
    });
    const result = await db().resume.findUniqueOrThrow({
      where: { id: r.id },
      include: {
        extraction: true,
        candidate: { include: { education: true } },
      },
    });
    expect(result.extraction).toMatchObject({
      name: "Synthetic Person",
      email: "synthetic@example.com",
      designation: "Mechanical Engineer",
      overallConfidence: 0.94,
      requiresReview: true,
    });
    expect(result.extraction?.reviewedAt).toBeTruthy();
    expect(result.status).toBe("REVIEW");
    expect(result.candidate?.summary).toBe("Original summary");
    expect(result.candidate?.education).toHaveLength(1);
    const paths = (await readCandidateProvenance(db(), r.id))[0].evidence.map(
      (e) => e.fieldPath,
    );
    expect(paths).toEqual(["basic.designation"]);
    expect(result.candidate?.verifiedAt).toBeNull();
    await expect(
      patchCandidate(db(), r.id, "synthetic-reviewer", {
        expectedRevision: 4,
        basic: { name: "Stale Name" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("completes workflow review without claiming verification of every field", async () => {
    const r = await resume();
    await patchCandidate(db(), r.id, "synthetic-reviewer", {
      expectedRevision: 4,
      completeReview: true,
    });
    const result = await db().resume.findUniqueOrThrow({
      where: { id: r.id },
      include: {
        extraction: true,
        candidate: { include: { education: true } },
      },
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.extraction?.requiresReview).toBe(false);
    expect(result.candidate?.education[0].verifiedAt).toBeNull();
    expect(result.candidate?.verifiedAt).toBeNull();
    expect(
      (await readCandidateProvenance(db(), r.id))[0].evidence.map(
        (e) => e.fieldPath,
      ),
    ).toEqual(["review.completed"]);
  });
  it("records the specific edited education field without overwriting the institution", async () => {
    const r = await resume(),
      education = await db().candidateEducation.findFirstOrThrow({
        where: { resumeId: r.id },
      });
    await patchCandidate(db(), r.id, "synthetic-reviewer", {
      expectedRevision: 4,
      education: {
        upsert: [{ id: education.id, degree: "Master of Science" }],
      },
    });
    expect(
      await db().candidateEducation.findUniqueOrThrow({
        where: { id: education.id },
      }),
    ).toMatchObject({
      degree: "Master of Science",
      institution: "Synthetic College",
    });
    const paths = (await readCandidateProvenance(db(), r.id))[0].evidence.map(
      (e) => e.fieldPath,
    );
    expect(paths).toContain(`education.${education.id}.degree`);
    expect(paths).not.toContain(`education.${education.id}.institution`);
  });
  it("preserves cancellation and rejects identity review of active processing", async () => {
    const r = await resume();
    for (const status of ["CANCELLED", "PROCESSING"] as const) {
      await db().resume.update({ where: { id: r.id }, data: { status } });
      await expect(
        patchCandidate(db(), r.id, "synthetic-reviewer", {
          expectedRevision: 4,
          basic: { name: "Changed Name" },
        }),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect(
      (
        await db().candidateProfile.findUniqueOrThrow({
          where: { resumeId: r.id },
        })
      ).revision,
    ).toBe(4);
  });
});
