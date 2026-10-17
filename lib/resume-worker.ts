import { diagnosticContext, withJobDiagnostics, correlateClaim, emitDiagnostic } from "./runtime-diagnostics";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { safeProcessingError } from "./processing-diagnostics";
import { resumeExecution } from "./resume-execution";
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

export async function runResumeJob(
  db: PrismaClient,
  data: { resumeId: string; generation?: number },
  hybridRuntime?: WorkerHybridRuntime,
  signal?: AbortSignal,
) {
  if (!diagnosticContext()) return withJobDiagnostics(data, undefined, () => runObservedResumeJob(db, data, hybridRuntime, signal));
  return runObservedResumeJob(db, data, hybridRuntime, signal);
}
async function runObservedResumeJob(
  db: PrismaClient,
  data: { resumeId: string; generation?: number },
  hybridRuntime?: WorkerHybridRuntime,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return "skipped";
  let stage = "claim";
  emitDiagnostic("processing_phase", { stage });
  const claimStarted = performance.now();
  const resume = await claimResume(db, data.resumeId, data.generation ?? 0).catch(error => {
    emitDiagnostic("claim_result", { valid: false, elapsedMs: performance.now() - claimStarted, error });
    console.error(JSON.stringify({ event: "resume_claim_failed", stage, retryStage: "QUEUE_RETRY", error: safeProcessingError(error) }));
    throw error;
  });
  if (resume?.claimToken) correlateClaim(resume.claimToken);
  emitDiagnostic("claim_result", { valid: Boolean(resume?.claimToken), elapsedMs: performance.now() - claimStarted });
  if (!resume?.claimToken) return "skipped";
  const token = resume.claimToken;
  const observedRenew = async (renewalKind: "timer" | "boundary") => {
    const started = performance.now();
    try {
      const valid = await renewClaim(db, resume.id, token);
      emitDiagnostic("lease_renewal", { stage, renewalKind, valid, elapsedMs: performance.now() - started });
      return valid;
    } catch (error) {
      emitDiagnostic("lease_renewal", { stage, renewalKind, valid: false, elapsedMs: performance.now() - started, error });
      throw error;
    }
  };
  const observeDurable = async (operation: "claim_attempt" | "record_state", work: () => Promise<boolean>) => {
    const started = performance.now();
    try {
      const valid = await work();
      emitDiagnostic("durable_attempt", { operation, valid, elapsedMs: performance.now() - started });
      return valid;
    } catch (error) {
      emitDiagnostic("durable_attempt", { operation, valid: false, elapsedMs: performance.now() - started, error });
      throw error;
    }
  };
  let lost = false;
  const controller = new AbortController();
  const abort = () => {
    lost = true;
    emitDiagnostic("ownership_abort", { stage, aborted: true, valid: false,
      cancellationReason: signal?.reason === "WORKER_SHUTDOWN" ? "shutdown" : "queue" });
    controller.abort(new Error("OWNERSHIP_ABORT"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (lost || renewing) return;
    renewing = observedRenew("timer")
      .then((valid) => {
        if (!valid) {
          console.error(JSON.stringify({ event: "resume_ownership_lost", stage, retryStage: "OWNERSHIP_ABORT" }));
          lost = true;
          emitDiagnostic("ownership_abort", { stage, aborted: true, valid: false, cancellationReason: "database" });
          controller.abort(new Error("DATABASE_OWNERSHIP_LOST"));
        }
      })
      .catch((error) => {
        console.error(JSON.stringify({ event: "resume_lease_renewal_failed", stage, retryStage: "OWNERSHIP_ABORT", error: safeProcessingError(error) }));
        lost = true;
        emitDiagnostic("ownership_abort", { stage, aborted: true, valid: false, cancellationReason: "database" });
        controller.abort();
      })
      .finally(() => {
        renewing = undefined;
      });
  }, leaseMs / 3);
  const check = async () => {
    if (lost) return false;
    const valid = await observedRenew("boundary");
    if (!valid) {
      lost = true;
      emitDiagnostic("ownership_abort", { stage, aborted: true, valid: false, cancellationReason: "database" });
      controller.abort(new Error("DATABASE_OWNERSHIP_LOST"));
    }
    return !lost && valid;
  };
  let hybridExecution: Awaited<ReturnType<typeof processWorkerHybrid>>["execution"] | undefined;
  try {
    stage = "file_hash";
    emitDiagnostic("processing_phase", { stage });
    if (!["pdf", "docx", "jpg", "jpeg", "png"].includes(resume.fileType.toLowerCase()))
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
    emitDiagnostic("processing_phase", { stage });
    const isolated = await resumeExecution.extract(resume.filePath, {
      signal: controller.signal,
      onPhase: phase => { stage = phase; emitDiagnostic("processing_phase", { stage }); },
    });
    const { document } = isolated;
    const { text, usedOcr } = document;
    if (!(await check())) return "skipped";
    if (!text.trim()) throw new PermanentProcessingError("EMPTY_DOCUMENT");
    let structured = isolated.structured;
    const deterministic = structured;
    const configured = workerHybridConfig(hybridRuntime?.env);
    stage = "profile_protection_lookup";
    emitDiagnostic("processing_phase", { stage });
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
    emitDiagnostic("processing_phase", { stage });
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
          observeDurable("claim_attempt", () => claimHybridAttempt(db, resume.id, token, resume.processingGeneration)),
        recordAttemptState: state => observeDurable("record_state", () => recordHybridAttemptState(db, resume.id, token, resume.processingGeneration, state)),
      },
      hybridRuntime,
    );
    structured = hybrid.structured;
    hybridExecution = hybrid.execution;
    stage = "post_hybrid_ownership";
    emitDiagnostic("processing_phase", { stage });
    const extraction = structured.basic;
    if (!(await check())) return "skipped";
    extraction.overallConfidence =
      (extraction.nameConfidence +
        extraction.emailConfidence +
        extraction.phoneConfidence +
        extraction.designationConfidence) /
      4;
    stage = "finalization";
    emitDiagnostic("processing_phase", { stage });
    const finalizationStarted = performance.now();
    const finalized = await finalizeResume(db, resume.id, token, extraction, {
      parserVersion: structured.parserVersion,
      signal: controller.signal,
      generation: resume.processingGeneration,
      startedAt: resume.updatedAt,
      method: "LOCAL",
      structured,
      hybridFallback:
        hybrid.execution.mode === "apply" && hybrid.execution.invoked
          ? deterministic
          : undefined,
    }).catch(error => {
      emitDiagnostic("finalization_result", { committed: false, elapsedMs: performance.now() - finalizationStarted, error });
      throw error;
    });
    emitDiagnostic("finalization_result", { committed: finalized, elapsedMs: performance.now() - finalizationStarted });
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
    if (lost || signal?.aborted) return "skipped";
    if ((error as { name?: string })?.name === "DocumentTimeoutError") controller.abort(error);
    const reason = (error as { reason?: string })?.reason;
    if (reason === "EMPTY_DOCUMENT" || reason === "STRUCTURED_EXTRACTION_FAILED")
      error = new PermanentProcessingError(reason);
    console.error(JSON.stringify({ event: "resume_processing_exception", resumeId: resume.id, stage, attempt: resume.processingAttempts,
      generation: resume.processingGeneration, retryStage: "RECORD_FAILURE", error: safeProcessingError(error), hybrid: hybridExecution }));
    const recorded = await failResume(db, resume.id, token, error).catch(recordError => {
      console.error(JSON.stringify({ event: "resume_failure_recording_failed", stage: "failure_persistence", failedStage: stage,
        retryStage: "QUEUE_RETRY_OR_LEASE_RECOVERY", error: safeProcessingError(recordError) }));
      throw recordError;
    });
    emitDiagnostic("failure_recorded", { stage, committed: recorded });
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
    signal?.removeEventListener("abort", abort);
    await renewing;
  }
}
