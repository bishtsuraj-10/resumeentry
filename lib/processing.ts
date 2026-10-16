import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ResumeStatus,
  type ExtractionMethod,
} from "@prisma/client";
import type { ResumeExtraction } from "./resume-parser";
import type { StructuredExtraction } from "./resume-parser/index";
import { persistStructured } from "./resume-parser/persistence";
import { reviewDecision } from "./resume-parser/review-policy";
import { safeProcessingError } from "./processing-diagnostics";

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
      if (!isTransactionConflict(error) || attempt >= 9) throw error;
      // Spread contending completions rather than repeatedly waking them together.
      // These database retries do not consume document-processing attempts.
      const delay = Math.min(250, 20 * 2 ** attempt);
      await new Promise((resolve) =>
        setTimeout(resolve, delay + Math.floor(Math.random() * delay)),
      );
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

// A committed attempt survives Redis restarts and worker crashes. The marker
// fences one experimental AI phase per explicitly requested processing generation.
// Nothing is submitted to Ollama until this short transaction has committed.
export async function claimHybridAttempt(
  db: PrismaClient,
  id: string,
  token: string,
  generation: number,
) {
  return transaction(db, async (tx) => {
    const resume = await tx.resume.findFirst({
      where: {
        ...owned(id, token, await databaseNow(tx)),
        processingGeneration: generation,
        extraction: { isNot: { reviewedAt: { not: null } } },
        batch: { isNot: { status: "CANCELLED" } },
      },
    });
    if (!resume) return false;
    const parserVersion = `worker-hybrid-attempt-g${generation}`;
    const previous = await tx.extractionRun.findFirst({
        where: { resumeId: id, parserVersion },
        select: { id: true, evidence: { where: { fieldPath: "processing.hybrid.attempt" }, select: { text: true } } },
      });
    if (previous) {
      // Legacy reservations are ambiguous. Only an explicit live-process proof
      // that zero generate requests started permits reuse of a reservation.
      if (previous.evidence?.length !== 1 || previous.evidence[0].text !== "EXPERIMENTAL_AI_NO_REQUEST") return false;
      return (await tx.candidateEvidence.updateMany({ where: { runId: previous.id, fieldPath: "processing.hybrid.attempt", text: "EXPERIMENTAL_AI_NO_REQUEST" },
        data: { text: "EXPERIMENTAL_AI_RESERVED_V2" } })).count === 1;
    }
    await tx.extractionRun.create({
      data: {
        resumeId: id,
        method: "LOCAL",
        parserVersion,
        startedAt: new Date(),
        evidence: {
          create: {
            fieldPath: "processing.hybrid.attempt",
            sourceSection: "processing",
            text: "EXPERIMENTAL_AI_RESERVED_V2",
            confidence: 0,
          },
        },
      },
    });
    return true;
  });
}

export type HybridAttemptState = "REQUEST_INTENT" | "COMPLETED" | "NO_REQUEST" | "UNCERTAIN";
export async function recordHybridAttemptState(db: PrismaClient, id: string, token: string, generation: number, state: HybridAttemptState) {
  return transaction(db, async tx => {
    if (!await tx.resume.findFirst({ where: { ...owned(id, token, await databaseNow(tx)), processingGeneration: generation,
      extraction: { isNot: { reviewedAt: { not: null } } } }, select: { id: true } })) return false;
    const run = await tx.extractionRun.findFirst({ where: { resumeId: id, parserVersion: `worker-hybrid-attempt-g${generation}` }, select: { id: true } });
    if (!run) return false;
    const allowed = state === "REQUEST_INTENT" ? ["EXPERIMENTAL_AI_RESERVED_V2", "EXPERIMENTAL_AI_COMPLETED"] :
      state === "NO_REQUEST" ? ["EXPERIMENTAL_AI_RESERVED_V2", "EXPERIMENTAL_AI_REQUEST_INTENT"] : ["EXPERIMENTAL_AI_REQUEST_INTENT"];
    return (await tx.candidateEvidence.updateMany({ where: { runId: run.id, fieldPath: "processing.hybrid.attempt", text: { in: allowed } },
      data: { text: `EXPERIMENTAL_AI_${state}` } })).count === 1;
  });
}

export async function finalizeResume(
  db: PrismaClient,
  id: string,
  token: string,
  extraction: ResumeExtraction,
  provenance?: {
    parserVersion: string;
    startedAt: Date;
    method?: ExtractionMethod;
    structured?: StructuredExtraction;
    hybridFallback?: StructuredExtraction;
  },
) {
  return transaction(db, async (tx) => {
    const result = await tx.resume.updateMany({
      where: {
        ...owned(id, token, await databaseNow(tx)),
        extraction: { isNot: { reviewedAt: { not: null } } },
      },
      data: {
        // Acquire the existing fence; the final status is decided after persistence.
        status: "REVIEW",
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
    // First-fill protection is checked inside the same serializable transaction
    // as persistence, including profiles created while inference was in flight.
    if (
      provenance?.hybridFallback &&
      (existing ||
        (await tx.candidateProfile.findUnique({
          where: { resumeId: id },
          select: { resumeId: true },
        })))
    ) {
      const fallback = {
        ...provenance.hybridFallback,
        warnings: [
          ...new Set([
            ...provenance.hybridFallback.warnings,
            "EXPERIMENTAL_HYBRID_REVIEW",
          ]),
        ],
      };
      extraction = fallback.basic;
      provenance = {
        ...provenance,
        parserVersion: fallback.parserVersion,
        structured: fallback,
      };
    }
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
      create: { resumeId: id, ...extraction, requiresReview: true },
      update: { ...extraction, requiresReview: true },
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
    const run = await tx.extractionRun.create({
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
    if (provenance?.structured)
      await persistStructured(tx, id, run.id, provenance.structured);
    const savedExtraction = await tx.resumeExtraction.findUniqueOrThrow({
      where: { resumeId: id },
    });
    const candidate = await tx.candidateProfile.findUnique({
      where: { resumeId: id },
      include: { skills: { include: { skill: true } }, links: true },
    });
    const decision = reviewDecision(
      savedExtraction,
      candidate,
      provenance?.structured?.warnings,
    );
    await tx.resumeExtraction.update({
      where: { resumeId: id },
      data: { requiresReview: decision.requiresReview },
    });
    await tx.resume.update({
      where: { id },
      data: {
        status: duplicate
          ? "DUPLICATE"
          : decision.requiresReview
            ? "REVIEW"
            : "COMPLETED",
      },
    });
    await tx.candidateEvidence.create({
      data: {
        runId: run.id,
        fieldPath: "review.automatic",
        sourceSection: "review",
        confidence: savedExtraction.overallConfidence,
        text: decision.reasons.join(", ") || "AUTOMATIC_COMPLETION_ELIGIBLE",
        location: { signals: decision.reasons, threshold: decision.threshold },
      },
    });
    await reconcileBatch(tx, resume.batchId);
    return true;
  });
}

export class PermanentProcessingError extends Error {
  constructor(
    public readonly reason:
      | "FILE_HASH_MISMATCH"
      | "UNSUPPORTED_FORMAT"
      | "EMPTY_DOCUMENT"
      | "STRUCTURED_EXTRACTION_FAILED"
      | "INVALID_DOCUMENT" = "INVALID_DOCUMENT",
  ) {
    super(reason);
  }
}

export function classifyError(error: unknown) {
  const e = error as { name?: string; code?: string };
  const permanent =
    error instanceof PermanentProcessingError ||
    [
      "InvalidPDFException",
      "PasswordException",
      "FormatError",
      "DocumentLimitError",
    ].includes(e?.name ?? "");
  // Unknown errors receive bounded retries; messages may contain private text.
  const reason =
    error instanceof PermanentProcessingError
      ? error.reason
      : [
            "InvalidPDFException",
            "PasswordException",
            "FormatError",
            "DocumentLimitError",
          ].includes(e?.name ?? "")
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
              "P2028",
              "P2024",
              "P1017",
              "P1002",
              "P1008",
            ].includes(e?.code ?? "")
          ? e.code
          : safeProcessingError(error).code;
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
