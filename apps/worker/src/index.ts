import "dotenv/config";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { db } from "../../../lib/db";
import {
  ConfiguredAIParser,
  extractResumeFields,
  LocalResumeParser,
} from "../../../lib/resume-parser";

const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
const parser = new LocalResumeParser();
const aiParser = new ConfiguredAIParser();
const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 75) / 100;
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 5));

async function markBatchProcessed(batchId: string | null) {
  if (!batchId) return;
  const batch = await db.processingBatch.update({
    where: { id: batchId },
    data: { processedFiles: { increment: 1 } },
  });
  if (
    batch.status !== "UPLOADING" &&
    batch.status !== "CANCELLED" &&
    batch.processedFiles >= batch.totalFiles
  )
    await db.processingBatch.update({
      where: { id: batchId },
      data: { status: "COMPLETED" },
    });
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function processResume(job: Job<{ resumeId: string }>) {
  const resume = await db.resume.findUnique({
    where: { id: job.data.resumeId },
  });
  if (!resume || resume.status === "COMPLETED" || resume.status === "DUPLICATE")
    return;
  await db.resume.update({
    where: { id: resume.id },
    data: { status: "PROCESSING" },
  });
  try {
    const actualHash = await hashFile(resume.filePath);
    if (actualHash !== resume.fileHash)
      throw new Error("Stored file hash does not match the uploaded file.");
    const { text, usedOcr } = await parser.extractText(resume.filePath);
    if (!text.trim())
      throw new Error("No readable text could be extracted from this resume.");
    const extraction = extractResumeFields(text, resume.fileName);
    try {
      const ai = await aiParser.parseResume(text);
      if (ai.name && extraction.nameConfidence < 0.6) {
        extraction.name = ai.name;
        extraction.nameConfidence = 0.8;
      }
      if (ai.designation && extraction.designationConfidence < 0.6) {
        extraction.designation = ai.designation;
        extraction.designationConfidence = 0.8;
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "ai_parsing_failed",
          resumeId: resume.id,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
    const duplicate = await db.resumeExtraction.findFirst({
      where: {
        resumeId: { not: resume.id },
        OR: [
          ...(extraction.email ? [{ email: extraction.email }] : []),
          ...(extraction.normalizedPhone
            ? [{ normalizedPhone: extraction.normalizedPhone }]
            : []),
          ...(extraction.name && extraction.normalizedPhone
            ? [
                {
                  name: extraction.name,
                  normalizedPhone: extraction.normalizedPhone,
                },
              ]
            : []),
        ],
      },
      select: { resumeId: true },
    });
    const overall =
      (extraction.nameConfidence +
        extraction.emailConfidence +
        extraction.phoneConfidence +
        extraction.designationConfidence) /
      4;
    const requiresReview =
      overall < threshold ||
      !extraction.name ||
      !extraction.email ||
      !extraction.phone ||
      !extraction.designation;
    await db.$transaction(async (tx) => {
      await tx.resumeExtraction.upsert({
        where: { resumeId: resume.id },
        create: {
          resumeId: resume.id,
          ...extraction,
          overallConfidence: overall,
          requiresReview,
        },
        update: { ...extraction, overallConfidence: overall, requiresReview },
      });
      await tx.resume.update({
        where: { id: resume.id },
        data: {
          status: duplicate
            ? "DUPLICATE"
            : requiresReview
              ? "REVIEW"
              : "COMPLETED",
          duplicateOf: duplicate?.resumeId ?? null,
          processedAt: new Date(),
        },
      });
      if (duplicate)
        await tx.duplicate.upsert({
          where: {
            resumeId_originalResumeId: {
              resumeId: resume.id,
              originalResumeId: duplicate.resumeId,
            },
          },
          create: {
            resumeId: resume.id,
            originalResumeId: duplicate.resumeId,
            matchType: "CANDIDATE",
          },
          update: {},
        });
    });
    await markBatchProcessed(resume.batchId);
    console.info(
      JSON.stringify({
        event: "resume_processing_completed",
        resumeId: resume.id,
        usedOcr,
        status: duplicate
          ? "DUPLICATE"
          : requiresReview
            ? "REVIEW"
            : "COMPLETED",
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown processing error";
    await db.extractionError.create({
      data: {
        resumeId: resume.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorMessage: message.slice(0, 500),
        retryCount: job.attemptsMade + 1,
      },
    });
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
    if (lastAttempt) {
      await db.resume.update({
        where: { id: resume.id },
        data: { status: "FAILED", processedAt: new Date() },
      });
      await markBatchProcessed(resume.batchId);
    }
    console.error(
      JSON.stringify({
        event: "resume_processing_failed",
        resumeId: resume.id,
        attempt: job.attemptsMade + 1,
        error: message.slice(0, 300),
      }),
    );
    throw error;
  }
}

const worker = new Worker("resume-processing", processResume, {
  connection,
  concurrency,
});
connection.on("error", (error) =>
  console.error(
    JSON.stringify({
      event: "redis_connection_error",
      code: (error as Error & { code?: string }).code ?? null,
      message: error.message || "Redis connection failed.",
    }),
  ),
);
worker.on("error", (error) =>
  console.error(
    JSON.stringify({
      event: "worker_error",
      code: (error as Error & { code?: string }).code ?? null,
      message: error.message || error.name || "Worker failed.",
    }),
  ),
);
console.info(JSON.stringify({ event: "worker_started", concurrency }));
const shutdown = async () => {
  await worker.close();
  await connection.quit();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
