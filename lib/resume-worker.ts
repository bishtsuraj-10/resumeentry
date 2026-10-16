import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { safeProcessingError } from "./processing-diagnostics";
import { extractStructuredResume, LocalResumeParser } from "./resume-parser";
import {
  processWorkerHybrid,
  workerHybridConfig,
  type WorkerHybridRuntime,
} from "./resume-parser/worker-hybrid";
import {
  claimResume,
  claimHybridAttempt,
  recordHybridAttemptState,
  classifyError,
  failResume,
  finalizeResume,
  leaseMs,
  PermanentProcessingError,
  renewClaim,
} from "./processing";

const parser = new LocalResumeParser();
export async function runResumeJob(
  db: PrismaClient,
  data: { resumeId: string; generation?: number },
  hybridRuntime?: WorkerHybridRuntime,
) {
  let stage = "claim";
  const resume = await claimResume(db, data.resumeId, data.generation ?? 0).catch(error => {
    console.error(JSON.stringify({ event: "resume_claim_failed", stage, retryStage: "QUEUE_RETRY", error: safeProcessingError(error) }));
    throw error;
  });
  if (!resume?.claimToken) return "skipped";
  const token = resume.claimToken;
  let lost = false;
  const controller = new AbortController();
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (lost || renewing) return;
    renewing = renewClaim(db, resume.id, token)
      .then((valid) => {
        if (!valid) {
          console.error(JSON.stringify({ event: "resume_ownership_lost", stage, retryStage: "OWNERSHIP_ABORT" }));
          lost = true;
          controller.abort();
        }
      })
      .catch((error) => {
        console.error(JSON.stringify({ event: "resume_lease_renewal_failed", stage, retryStage: "OWNERSHIP_ABORT", error: safeProcessingError(error) }));
        lost = true;
        controller.abort();
      })
      .finally(() => {
        renewing = undefined;
      });
  }, leaseMs / 3);
  const check = async () => !lost && (await renewClaim(db, resume.id, token));
  let hybridExecution: Awaited<ReturnType<typeof processWorkerHybrid>>["execution"] | undefined;
  try {
    stage = "file_hash";
    if (!parser.canParse(`.${resume.fileType}`))
      throw new PermanentProcessingError("UNSUPPORTED_FORMAT");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resume.filePath)) {
      if (lost) return "skipped";
      hash.update(chunk);
    }
    if (hash.digest("hex") !== resume.fileHash)
      throw new PermanentProcessingError("FILE_HASH_MISMATCH");
    if (!(await check())) return "skipped";
    stage = "document_reader";
    const document = await parser.extractText(resume.filePath, {
      signal: controller.signal,
    });
    const { text, usedOcr } = document;
    if (!(await check())) return "skipped";
    if (!text.trim()) throw new PermanentProcessingError("EMPTY_DOCUMENT");
    let structured: ReturnType<typeof extractStructuredResume>;
    stage = "deterministic_extraction";
    try {
      structured = extractStructuredResume(text, {
        documentWarnings: document.warnings,
      });
    } catch {
      // Pure structured extraction failures are deterministic for these bytes;
      // queue retries cannot repair them. Do not log private exception messages.
      throw new PermanentProcessingError("STRUCTURED_EXTRACTION_FAILED");
    }
    const deterministic = structured;
    const configured = workerHybridConfig(hybridRuntime?.env);
    stage = "profile_protection_lookup";
    const existing =
      configured.mode === "off"
        ? null
        : await db.resume.findUnique({
            where: { id: resume.id },
            select: {
              extraction: { select: { resumeId: true } },
              candidate: { select: { resumeId: true } },
            },
          });
    stage = "hybrid";
    const hybrid = await processWorkerHybrid(
      text,
      structured,
      {
        resumeId: resume.id,
        generation: resume.processingGeneration,
        fileHash: resume.fileHash,
        batchId: resume.batchId,
        createdAt: resume.createdAt,
        protectedCandidate: Boolean(
          existing?.extraction || existing?.candidate,
        ),
        signal: controller.signal,
        checkOwnership: check,
        claimAttempt: () =>
          claimHybridAttempt(db, resume.id, token, resume.processingGeneration),
        recordAttemptState: state => recordHybridAttemptState(db, resume.id, token, resume.processingGeneration, state),
      },
      hybridRuntime,
    );
    structured = hybrid.structured;
    hybridExecution = hybrid.execution;
    stage = "post_hybrid_ownership";
    const extraction = structured.basic;
    if (!(await check())) return "skipped";
    extraction.overallConfidence =
      (extraction.nameConfidence +
        extraction.emailConfidence +
        extraction.phoneConfidence +
        extraction.designationConfidence) /
      4;
    stage = "finalization";
    const finalized = await finalizeResume(db, resume.id, token, extraction, {
      parserVersion: structured.parserVersion,
      startedAt: resume.updatedAt,
      method: "LOCAL",
      structured,
      hybridFallback:
        hybrid.execution.mode === "apply" && hybrid.execution.invoked
          ? deterministic
          : undefined,
    });
    let savedReview: { status: string; requiresReview: boolean | null } | null =
      null;
    if (finalized) {
      // Logging failure must not turn a committed completion into a retry.
      try {
        const saved = await db.resume.findUnique({
          where: { id: resume.id },
          select: {
            status: true,
            extraction: { select: { requiresReview: true } },
          },
        });
        if (saved)
          savedReview = {
            status: saved.status,
            requiresReview: saved.extraction?.requiresReview ?? null,
          };
      } catch {
        /* Completion has already committed. */
      }
      console.info(
        JSON.stringify({
          event: "resume_processing_completed",
          resumeId: resume.id,
          usedOcr,
          ocrPages: document.ocrPages,
          documentMs: document.durationMs,
          extractionMs: Math.round(structured.durationMs),
          warningCount: structured.warnings.length,
          hybrid: hybrid.execution,
          review: savedReview,
        }),
      );
    }
    return finalized ? "completed" : "skipped";
  } catch (error) {
    console.error(JSON.stringify({ event: "resume_processing_exception", resumeId: resume.id, stage, attempt: resume.processingAttempts,
      generation: resume.processingGeneration, retryStage: "RECORD_FAILURE", error: safeProcessingError(error), hybrid: hybridExecution }));
    const recorded = await failResume(db, resume.id, token, error).catch(recordError => {
      console.error(JSON.stringify({ event: "resume_failure_recording_failed", stage: "failure_persistence", failedStage: stage,
        retryStage: "QUEUE_RETRY_OR_LEASE_RECOVERY", error: safeProcessingError(recordError) }));
      throw recordError;
    });
    if (!recorded) return "skipped";
    console.error(
      JSON.stringify({
        event: "resume_processing_failed",
        resumeId: resume.id,
        attempt: resume.processingAttempts,
        type: classifyError(error).type,
        stage,
        error: safeProcessingError(error),
        retryStage: classifyError(error).permanent ? "TERMINAL" : "PROCESSING_RETRY_WITH_ADMISSION_CHECK",
        hybrid: hybridExecution,
      }),
    );
    return classifyError(error).permanent ? "permanent" : "retry";
  } finally {
    clearInterval(timer);
    await renewing;
  }
}
