import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ResumeStatus,
  type ExtractionMethod,
} from "@prisma/client";
import type { ResumeExtraction } from "./resume-parser";

export const terminalStatuses: ResumeStatus[] = [
  "COMPLETED",
  "REVIEW",
  "DUPLICATE",
  "FAILED",
  "CANCELLED",
];
export const leaseMs = 120_000;
export const maxAttempts = 3;
type Tx = Prisma.TransactionClient;
export function isTransactionConflict(error: unknown): boolean {
  const e = error as {
    code?: string;
    meta?: { code?: string };
    cause?: { kind?: string; originalCode?: string };
  };
  return (
    e?.code === "P2034" ||
    ["40001", "40P01"].includes(e?.code ?? "") ||
    (e?.code === "P2010" && ["40001", "40P01"].includes(e.meta?.code ?? "")) ||
    e?.cause?.kind === "TransactionWriteConflict" ||
    ["40001", "40P01"].includes(e?.cause?.originalCode ?? "")
  );
}
async function databaseNow(tx: Tx | PrismaClient) {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return row.now;
}

// Serializable retries cover concurrent counters, reviews, cancellation and
// candidate identity predicates. No file/Redis/network work belongs here.
export async function transaction<T>(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

export async function reconcileBatch(tx: Tx, batchId: string | null) {
  if (!batchId) return;
  // Serializable isolation and the batch update serialize progress without
  // acquiring parent row locks after child locks.
  const batch = await tx.processingBatch.findUniqueOrThrow({
    where: { id: batchId },
  });
  const totalFiles = await tx.resume.count({ where: { batchId } });
  const processedFiles = await tx.resume.count({
    where: { batchId, status: { in: terminalStatuses } },
  });
  await tx.processingBatch.update({
    where: { id: batchId },
    data: {
      totalFiles,
      processedFiles,
      status: ["UPLOADING", "CANCELLED"].includes(batch.status)
        ? batch.status
        : processedFiles === totalFiles
          ? "COMPLETED"
          : "PROCESSING",
    },
  });
}

export async function claimResume(
  db: PrismaClient,
  id: string,
  generation: number,
) {
  const token = randomUUID();
  return transaction(db, async (tx) => {
    const now = await databaseNow(tx);
    const changed = await tx.resume.updateMany({
      where: {
        id,
        processingGeneration: generation,
        processingAttempts: { lt: maxAttempts },
        OR: [
          { status: "PENDING" },
          {
            status: "PROCESSING",
            OR: [{ leaseUntil: { lte: now } }, { leaseUntil: null }],
          },
        ],
        batch: { isNot: { status: "CANCELLED" } },
        extraction: { isNot: { reviewedAt: { not: null } } },
      },
      data: {
        status: "PROCESSING",
        claimToken: token,
        leaseUntil: new Date(now.getTime() + leaseMs),
        processingAttempts: { increment: 1 },
      },
    });
    return changed.count
      ? tx.resume.findUniqueOrThrow({ where: { id } })
      : null;
  });
}

export function owned(id: string, token: string, now: Date) {
  return {
    id,
    status: "PROCESSING" as const,
    claimToken: token,
    leaseUntil: { gt: now },
  };
}

export async function renewClaim(db: PrismaClient, id: string, token: string) {
  const changed = await db.$executeRaw`UPDATE "Resume"
    SET "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond', "updatedAt" = clock_timestamp()
    WHERE id = ${id} AND status = 'PROCESSING' AND "claimToken" = ${token}
      AND "leaseUntil" > clock_timestamp()`;
  return changed === 1;
}

export async function finalizeResume(
  db: PrismaClient,
  id: string,
  token: string,
  extraction: ResumeExtraction,
  requiresReview: boolean,
  provenance?: {
    parserVersion: string;
    startedAt: Date;
    method?: ExtractionMethod;
  },
) {
  return transaction(db, async (tx) => {
    const result = await tx.resume.updateMany({
      where: {
        ...owned(id, token, await databaseNow(tx)),
        extraction: { isNot: { reviewedAt: { not: null } } },
      },
      data: {
        status: requiresReview ? "REVIEW" : "COMPLETED",
        claimToken: null,
        leaseUntil: null,
        processedAt: new Date(),
      },
    });
    if (!result.count) return false;
    const resume = await tx.resume.findUniqueOrThrow({ where: { id } });
    const existing = await tx.resumeExtraction.findUnique({
      where: { resumeId: id },
    });
    if (existing?.reviewedAt)
      throw new Error("Reviewed extraction cannot be replaced");
    const predicates = [
      ...(extraction.email ? [{ email: extraction.email }] : []),
      ...(extraction.normalizedPhone
        ? [{ normalizedPhone: extraction.normalizedPhone }]
        : []),
    ];
    const duplicate = predicates.length
      ? await tx.resumeExtraction.findFirst({
          where: {
            resumeId: { not: id },
            OR: predicates,
            resume: { status: { in: ["COMPLETED", "REVIEW", "DUPLICATE"] } },
          },
          orderBy: { resumeId: "asc" },
          select: { resumeId: true },
        })
      : null;
    await tx.resumeExtraction.upsert({
      where: { resumeId: id },
      create: { resumeId: id, ...extraction, requiresReview },
      update: { ...extraction, requiresReview },
    });
    await tx.resume.update({
      where: { id },
      data: {
        duplicateOf: duplicate?.resumeId ?? null,
        ...(duplicate ? { status: "DUPLICATE" } : {}),
      },
    });
    if (duplicate)
      await tx.duplicate.upsert({
        where: {
          resumeId_originalResumeId: {
            resumeId: id,
            originalResumeId: duplicate.resumeId,
          },
        },
        create: {
          resumeId: id,
          originalResumeId: duplicate.resumeId,
          matchType: "CANDIDATE",
        },
        update: {},
      });
    await reconcileBatch(tx, resume.batchId);
    await tx.extractionRun.create({
      data: {
        resumeId: id,
        method: provenance?.method ?? "LOCAL",
        parserVersion: provenance?.parserVersion ?? "local-basic-v1",
        startedAt: provenance?.startedAt ?? new Date(),
        completedAt: new Date(),
        evidence: {
          create: [
            { fieldPath: "basic.name", confidence: extraction.nameConfidence },
            {
              fieldPath: "basic.email",
              confidence: extraction.emailConfidence,
            },
            {
              fieldPath: "basic.phone",
              confidence: extraction.phoneConfidence,
            },
            {
              fieldPath: "basic.designation",
              confidence: extraction.designationConfidence,
            },
          ],
        },
      },
    });
    return true;
  });
}

export class PermanentProcessingError extends Error {
  constructor(
    public readonly reason:
      | "FILE_HASH_MISMATCH"
      | "UNSUPPORTED_FORMAT"
      | "EMPTY_DOCUMENT"
      | "INVALID_DOCUMENT" = "INVALID_DOCUMENT",
  ) {
    super(reason);
  }
}

export function classifyError(error: unknown) {
  const e = error as { name?: string; code?: string };
  const permanent =
    error instanceof PermanentProcessingError ||
    ["InvalidPDFException", "PasswordException", "FormatError"].includes(
      e?.name ?? "",
    );
  // Unknown errors receive bounded retries; messages may contain private text.
  const reason =
    error instanceof PermanentProcessingError
      ? error.reason
      : ["InvalidPDFException", "PasswordException", "FormatError"].includes(
            e?.name ?? "",
          )
        ? e.name
        : [
              "ECONNRESET",
              "ECONNREFUSED",
              "ETIMEDOUT",
              "ENOENT",
              "EIO",
              "EACCES",
              "P1001",
              "P2034",
            ].includes(e?.code ?? "")
          ? e.code
          : "UNKNOWN";
  return {
    permanent,
    type: permanent ? "PERMANENT" : "RETRYABLE",
    message: `${permanent ? "Document validation or decoding failed" : "Processing dependency or extraction failed"} (${reason}).`,
  };
}

export async function failResume(
  db: PrismaClient,
  id: string,
  token: string,
  error: unknown,
) {
  const failure = classifyError(error);
  return transaction(db, async (tx) => {
    const resume = await tx.resume.findFirst({
      where: owned(id, token, await databaseNow(tx)),
    });
    if (!resume) return false;
    const terminal =
      failure.permanent || resume.processingAttempts >= maxAttempts;
    const changed = await tx.resume.updateMany({
      where: owned(id, token, await databaseNow(tx)),
      data: {
        status: terminal ? "FAILED" : "PENDING",
        claimToken: null,
        leaseUntil: null,
        processedAt: terminal ? new Date() : null,
        scheduleAfter: new Date(Date.now() + 30_000),
      },
    });
    if (!changed.count) return false;
    await tx.extractionError.create({
      data: {
        resumeId: id,
        errorType: failure.type,
        errorMessage: failure.message,
        retryCount: resume.processingAttempts,
      },
    });
    if (terminal) await reconcileBatch(tx, resume.batchId);
    return true;
  });
}

export async function retryResume(db: PrismaClient, id: string, actor: string) {
  return transaction(db, async (tx) => {
    const changed = await tx.resume.updateMany({
      where: {
        id,
        status: "FAILED",
        batch: { isNot: { status: "CANCELLED" } },
        extraction: { isNot: { reviewedAt: { not: null } } },
      },
      data: {
        status: "PENDING",
        processedAt: null,
        claimToken: null,
        leaseUntil: null,
        processingGeneration: { increment: 1 },
        processingAttempts: 0,
        scheduleAfter: new Date(),
      },
    });
    if (!changed.count) return null;
    const resume = await tx.resume.findUniqueOrThrow({ where: { id } });
    await reconcileBatch(tx, resume.batchId);
    await tx.auditLog.create({
      data: { actor, action: "resume.retried", targetId: id },
    });
    return resume;
  });
}

export async function recoverExpired(db: PrismaClient, limit = 100) {
  const now = await databaseNow(db);
  const expired = await db.resume.findMany({
    where: {
      status: "PROCESSING",
      OR: [{ leaseUntil: { lte: now } }, { leaseUntil: null }],
    },
    orderBy: { leaseUntil: "asc" },
    take: limit,
  });
  for (const resume of expired)
    await transaction(db, async (tx) => {
      const terminal = resume.processingAttempts >= maxAttempts;
      const changed = await tx.resume.updateMany({
        where: {
          id: resume.id,
          status: "PROCESSING",
          claimToken: resume.claimToken,
          OR: [
            { leaseUntil: { lte: await databaseNow(tx) } },
            { leaseUntil: null },
          ],
        },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          claimToken: null,
          leaseUntil: null,
          scheduleAfter: new Date(),
          processedAt: terminal ? new Date() : null,
        },
      });
      if (!changed.count) return;
      await tx.extractionError.create({
        data: {
          resumeId: resume.id,
          errorType: "LEASE_EXPIRED",
          errorMessage: "Processing ownership expired before finalization.",
          retryCount: resume.processingAttempts,
        },
      });
      if (terminal) await reconcileBatch(tx, resume.batchId);
    });
}

export async function cancelBatch(db: PrismaClient, id: string, actor: string) {
  return transaction(db, async (tx) => {
    const changed = await tx.processingBatch.updateMany({
      where: { id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      data: { status: "CANCELLED" },
    });
    if (!changed.count) return null;
    const cancelled = await tx.resume.updateMany({
      where: { batchId: id, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "CANCELLED",
        processedAt: new Date(),
        claimToken: null,
        leaseUntil: null,
      },
    });
    await reconcileBatch(tx, id);
    await tx.auditLog.create({
      data: {
        actor,
        action: "batch.cancelled",
        targetId: id,
        metadata: { cancelledResumes: cancelled.count },
      },
    });
    return cancelled.count;
  });
}

type ReviewData = Pick<
  Prisma.ResumeExtractionUncheckedCreateInput,
  "name" | "email" | "phone" | "normalizedPhone" | "countryCode" | "designation"
>;
export async function saveReview(
  db: PrismaClient,
  id: string,
  actor: string,
  data: ReviewData,
) {
  return transaction(db, async (tx) => {
    // Human confirmation wins over active extraction by revoking ownership.
    const changed = await tx.resume.updateMany({
      where: {
        id,
        status: { not: "CANCELLED" },
        batch: { isNot: { status: "CANCELLED" } },
      },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        claimToken: null,
        leaseUntil: null,
      },
    });
    if (!changed.count) return null;
    const resume = await tx.resume.findUniqueOrThrow({ where: { id } });
    const extraction = await tx.resumeExtraction.upsert({
      where: { resumeId: id },
      create: {
        resumeId: id,
        ...data,
        requiresReview: false,
        reviewedAt: new Date(),
      },
      // Retain machine confidence; human verification is represented by reviewedAt.
      update: { ...data, requiresReview: false, reviewedAt: new Date() },
    });
    await reconcileBatch(tx, resume.batchId);
    const audit = await tx.auditLog.create({
      data: { actor, action: "resume.reviewed", targetId: id },
    });
    await tx.extractionRun.create({
      data: {
        resumeId: id,
        method: "HUMAN",
        startedAt: extraction.reviewedAt!,
        completedAt: extraction.reviewedAt!,
        evidence: {
          create: ["name", "email", "phone", "designation"].map((field) => ({
            fieldPath: "basic." + field,
            verifiedAt: extraction.reviewedAt,
            auditLogId: audit.id,
          })),
        },
      },
    });
    return extraction;
  });
}
