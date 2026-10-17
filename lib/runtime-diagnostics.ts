// Numeric/enum-only diagnostics. Never serialize caller objects or ownership tokens.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { freemem, totalmem } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { safeProcessingError } from "./processing-diagnostics";

const contexts = new AsyncLocalStorage<DiagnosticContext>();
const processInstance = randomUUID();
export interface DiagnosticContext {
  traceId: string;
  resumeRef?: string;
  jobRef?: string;
  generation?: number;
  claimRef?: string;
  requestRef?: string;
}
export const diagnosticRef = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 24);
export function diagnosticContext() { return contexts.getStore(); }
export function withExistingDiagnostics<T>(context: DiagnosticContext, work: () => T): T { return contexts.run(context, work); }
export function withJobDiagnostics<T>(data: { resumeId: string; generation?: number }, jobId: string | undefined, work: () => T): T {
  return contexts.run({ traceId: randomUUID(), resumeRef: diagnosticRef(data.resumeId),
    ...(jobId ? { jobRef: diagnosticRef(jobId) } : {}), generation: data.generation ?? 0 }, work);
}
export function withRequestDiagnostics<T>(work: () => T): T {
  return contexts.run({ ...contexts.getStore(), traceId: contexts.getStore()?.traceId ?? randomUUID(), requestRef: randomUUID() }, work);
}
export function correlateClaim(token: string) {
  const context = contexts.getStore();
  if (context) context.claimRef = diagnosticRef(token);
}

const events = new Set(["job_started", "job_finished", "processing_phase", "claim_result", "lease_renewal",
  "ownership_abort", "durable_attempt", "finalization_result", "failure_recorded", "hybrid_lifecycle", "ollama_request_finished",
  "queue_lock_renewed", "queue_lock_failed", "queue_stalled", "queue_failed", "queue_runtime_error",
  "redis_connection", "redis_command", "resource_sample", "execution_started", "execution_terminated", "execution_deadline", "execution_failed"]);
const enums: Record<string, Set<string>> = {
  cancellationReason: new Set(["database", "queue", "shutdown", "deadline", "parent"]),
  executionFailure: new Set(["crash", "exit", "protocol", "reader", "parser", "deadline", "cancelled", "unavailable"]),
  stage: new Set(["claim", "file_hash", "document_reader", "deterministic_extraction", "profile_protection_lookup", "hybrid", "post_hybrid_ownership", "finalization",
    "selection", "ownership_before_admission", "admission", "durable_reservation", "inference", "request_intent", "request_state_persistence", "post_inference_ownership", "no_request_proof",
    "preflight", "dispatch_guard", "generate", "response_read", "response_validation", "complete"]),
  outcome: new Set(["completed", "skipped", "retry", "permanent", "error", "success", "DISABLED", "BUSY", "INPUT_BUDGET", "ABORTED", "TIMEOUT", "UNAVAILABLE", "MODEL_NOT_INSTALLED", "REMOTE_MODEL_REJECTED", "MALFORMED_RESPONSE", "RESPONSE_BUDGET", "TRUNCATED_RESPONSE", "EMPTY_MODEL_RESPONSE", "NULL_MODEL_OUTPUT", "SCHEMA_REJECTED", "INVALID_RESPONSE_OR_UNAVAILABLE", "ADMITTED", "CAPACITY", "ALREADY_ATTEMPTED", "PROTECTED", "NOT_SELECTED", "ADMISSION_UNAVAILABLE", "OWNERSHIP_LOST", "ALREADY_ATTEMPTED_OR_PROTECTED", "COMPLETE", "NO_REQUEST", "DEPENDENCY_FAILURE", "ADMISSION_QUARANTINED"]),
  requestState: new Set(["NOT_STARTED", "RESERVED", "REQUEST_INTENT", "DISPATCHED", "COMPLETED", "UNCERTAIN", "NO_REQUEST"]),
  target: new Set(["professional", "identity", "skillsLinks", "employment", "education"]),
  connection: new Set(["queue", "admission"]),
  status: new Set(["connect", "ready", "close", "reconnecting", "end", "error"]),
  operation: new Set(["acquire", "transition", "release", "claim_attempt", "record_state"]),
  renewalKind: new Set(["timer", "boundary"]),
  correlationScope: new Set(["latest_job", "job_only"]),
};
const numericKeys = new Set(["elapsedMs", "httpStatus", "requests", "queueAttemptsMade", "count", "rssBytes", "heapUsedBytes", "externalBytes", "hostFreeBytes", "hostTotalBytes", "loopDelayP95Ms", "loopDelayMaxMs", "loopUtilization", "sampleIntervalMs", "clientElapsedMs", "serverTotalMs", "serverLoadMs", "serverPromptEvalMs", "serverGenerationMs", "promptTokens", "generatedTokens", "requestTimeoutMs", "documentBudgetMs", "contextTokens", "outputTokens", "maxInputChars", "maxCalls", "remainingBudgetMs"]);
const booleanKeys = new Set(["valid", "aborted", "invoked", "committed", "quarantined"]);
const refKeys = ["traceId", "resumeRef", "jobRef", "claimRef", "requestRef"] as const;
export function redactDiagnostic(input: Record<string, unknown>) {
  const result: Record<string, unknown> = { schemaVersion: 1 };
  result.event = events.has(String(input.event)) ? input.event : "unknown";
  for (const [key, value] of Object.entries(input)) {
    if (numericKeys.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value;
    if (booleanKeys.has(key) && typeof value === "boolean") result[key] = value;
    if (enums[key]?.has(String(value))) result[key] = value;
  }
  for (const key of refKeys) {
    const value = input[key];
    if (typeof value === "string" && /^(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value)) result[key] = value;
  }
  for (const key of ["generation", "processId"])
    if (Number.isSafeInteger(input[key]) && (input[key] as number) >= 0) result[key] = input[key];
  if (typeof input.processInstance === "string" && /^[a-f0-9-]{36}$/.test(input.processInstance)) result.processInstance = input.processInstance;
  if (typeof input.timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.timestamp)) result.timestamp = input.timestamp;
  if (input.error) result.error = safeProcessingError(input.error);
  return result;
}
export function emitDiagnostic(event: string, fields: Record<string, unknown> = {}) {
  try {
    console.info(JSON.stringify(redactDiagnostic({ ...fields, ...contexts.getStore(), event,
      timestamp: new Date().toISOString(), processId: process.pid, processInstance })));
  } catch { /* Telemetry cannot change processing outcomes. */ }
}
export async function observeRedisCommand<T>(operation: "acquire" | "transition" | "release", work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await work();
    emitDiagnostic("redis_command", { connection: "admission", operation, outcome: "success", elapsedMs: performance.now() - started });
    return value;
  } catch (error) {
    emitDiagnostic("redis_command", { connection: "admission", operation, outcome: "error", elapsedMs: performance.now() - started, error });
    throw error;
  }
}

const nonnegative = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
export function ollamaNumericTimings(envelope: unknown) {
  const input = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const [source, target] of Object.entries({ total_duration: "serverTotalMs", load_duration: "serverLoadMs", prompt_eval_duration: "serverPromptEvalMs", eval_duration: "serverGenerationMs" })) {
    const value = nonnegative(input[source]);
    if (value !== undefined) result[target] = value / 1_000_000;
  }
  for (const [source, target] of Object.entries({ prompt_eval_count: "promptTokens", eval_count: "generatedTokens" })) {
    const value = nonnegative(input[source]);
    if (value !== undefined && Number.isSafeInteger(value)) result[target] = value;
  }
  return result;
}
export function resourceSnapshot() {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external,
    hostFreeBytes: freemem(), hostTotalBytes: totalmem() };
}
// One optional process-wide monitor; no model/Redis/DB probes and no per-job sampler.
export function startResourceDiagnostics(enabled: boolean) {
  if (!enabled) return () => {};
  try {
    const histogram = monitorEventLoopDelay({ resolution: 50 });
    histogram.enable();
    let previous = performance.eventLoopUtilization();
    let sampledAt = performance.now();
    const timer = setInterval(() => {
      try {
        const now = performance.now();
        const current = performance.eventLoopUtilization();
        const utilization = performance.eventLoopUtilization(current, previous);
        emitDiagnostic("resource_sample", { ...resourceSnapshot(), sampleIntervalMs: now - sampledAt,
          ...(histogram.count > 0 ? { loopDelayP95Ms: histogram.percentile(95) / 1e6, loopDelayMaxMs: histogram.max / 1e6 } : {}),
          loopUtilization: utilization.utilization });
        previous = current; sampledAt = now; histogram.reset();
      } catch { /* Missing platform measurements cannot break the worker. */ }
    }, 5000);
    timer.unref();
    return () => { clearInterval(timer); histogram.disable(); };
  } catch {
    // Unsupported platform/monitor setup must not prevent the worker starting.
    return () => {};
  }
}
