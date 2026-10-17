import { diagnosticContext, diagnosticRef, emitDiagnostic, startResourceDiagnostics, withExistingDiagnostics, withJobDiagnostics, type DiagnosticContext } from "../../../lib/runtime-diagnostics";
import "dotenv/config";
import { Worker, UnrecoverableError } from "bullmq";
import IORedis from "ioredis";
import { db } from "../../../lib/db";
import { getResumeQueue } from "../../../lib/queue-client";
import { reconcileQueue } from "../../../lib/processing-queue";
import { runResumeJob } from "../../../lib/resume-worker";
import { connectQueueCancellation } from "../../../lib/worker-cancellation";
import { safeProcessingError } from "../../../lib/processing-diagnostics";
import {
  RedisHybridAdmission,
  workerHybridConfig,
} from "../../../lib/resume-parser/worker-hybrid";

const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
const configured = Number(process.env.WORKER_CONCURRENCY ?? 5);
const hybridMode = workerHybridConfig().mode;
const admissionRedis =
  hybridMode === "off"
    ? undefined
    : new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        commandTimeout: 3000,
      });
admissionRedis?.on("error", (error) =>
  console.error(JSON.stringify({ event: "hybrid_admission_unavailable", stage: "admission_connection", error: safeProcessingError(error) })),
);
const hybridRuntime = admissionRedis
  ? { admission: new RedisHybridAdmission(admissionRedis) }
  : undefined;
const concurrency =
  hybridMode !== "off"
    ? 1
    : Number.isFinite(configured)
      ? Math.max(1, Math.floor(configured))
      : 5;
const queue = getResumeQueue();
// Bounded recent contexts correlate late queue transition errors after processing returns.
const recentJobs = new Map<string, DiagnosticContext>();
function queueDiagnostic(event: string, jobId: string | undefined, fields: Record<string, unknown> = {}) {
  const context = jobId ? recentJobs.get(jobId) : undefined;
  const emit = () => emitDiagnostic(event, { ...fields, correlationScope: context ? "latest_job" : "job_only", ...(jobId ? { jobRef: diagnosticRef(jobId) } : {}) });
  if (context) withExistingDiagnostics(context, emit); else emit();
}
const stopResourceDiagnostics = startResourceDiagnostics(process.env.WORKER_RESOURCE_DIAGNOSTICS === "true");
for (const [name, client] of [["queue", connection], ["admission", admissionRedis]] as const) {
  if (!client) continue;
  for (const status of ["connect", "ready", "close", "reconnecting", "end", "error"] as const)
    client.on(status, () => emitDiagnostic("redis_connection", { connection: name, status }));
}
const worker = new Worker(
  "resume-processing",
  async (job, _token, signal) => withJobDiagnostics(job.data, job.id, async () => {
    if (job.id) {
      recentJobs.delete(job.id);
      recentJobs.set(job.id, diagnosticContext()!);
      if (recentJobs.size > 1000) recentJobs.delete(recentJobs.keys().next().value!);
    }
    emitDiagnostic("job_started", { queueAttemptsMade: job.attemptsMade });
    let outcome: string = "error";
    try {
      outcome = await runResumeJob(db, job.data, hybridRuntime, signal);
      if (outcome === "permanent")
        throw new UnrecoverableError("Document validation or decoding failed.");
      if (outcome === "retry")
        throw new Error("Resume processing failed; retry scheduled.");
    } finally { emitDiagnostic("job_finished", { outcome }); }
  }),
  { connection, concurrency },
);

connectQueueCancellation(worker);
worker.on("lockRenewalFailed", (ids) => {
  for (const id of ids) {
    queueDiagnostic("queue_lock_failed", id);
  }
});
worker.on("locksRenewed", ({ jobIds }) => {
  for (const id of jobIds) queueDiagnostic("queue_lock_renewed", id);
});
worker.on("stalled", (id) => queueDiagnostic("queue_stalled", id));
worker.on("failed", (job, error) => queueDiagnostic("queue_failed", job?.id, { error, queueAttemptsMade: job?.attemptsMade }));
worker.on("error", (error) => emitDiagnostic("queue_runtime_error", { error }));
connection.on("error", (error) =>
  console.error(JSON.stringify({ event: "redis_connection_error", stage: "queue_connection", error: safeProcessingError(error) })),
);
worker.on("error", (error) =>
  console.error(JSON.stringify({ event: "worker_error", stage: "bullmq_runtime", error: safeProcessingError(error) })),
);
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "queue_job_failed", stage: "bullmq_attempt",
  queueAttemptsMade: job?.attemptsMade, retryStage: "QUEUE_RETRY_POLICY", error: safeProcessingError(error) })));
worker.on("stalled", () => console.error(JSON.stringify({ event: "queue_job_stalled", stage: "bullmq_lock", retryStage: "STALL_RECOVERY" })));
let recovering = false;
let stopping = false;
async function recover() {
  if (recovering || stopping) return;
  recovering = true;
  try {
    const summary = await reconcileQueue(db, queue);
    if (summary.queued || summary.deferred)
      console.info(
        JSON.stringify({ event: "queue_reconciliation", ...summary }),
      );
  } catch (error) {
    console.error(JSON.stringify({ event: "queue_reconciliation_failed", stage: "reconciliation", error: safeProcessingError(error) }));
  } finally {
    recovering = false;
  }
}
void recover();
const recoveryTimer = setInterval(() => void recover(), 15_000);
console.info(
  JSON.stringify({ event: "worker_started", concurrency, hybridMode }),
);
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(recoveryTimer);
  stopResourceDiagnostics();
  worker.cancelAllJobs("WORKER_SHUTDOWN");
  await worker.close();
  while (recovering) await new Promise((resolve) => setTimeout(resolve, 50));
  await queue.close();
  await connection.quit();
  admissionRedis?.disconnect();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
