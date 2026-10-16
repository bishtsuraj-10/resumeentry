import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { extractHybridResume, type HybridResult } from "./hybrid";
import type { StructuredExtraction } from "./index";
import { NuExtractAdapter, nuConfig } from "./ollama-nuextract";
import { safeProcessingError } from "../processing-diagnostics";
import type { HybridAttemptState } from "../processing";

export type WorkerHybridMode = "off" | "shadow" | "apply";
export function workerHybridConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode: WorkerHybridMode =
    env.RESUME_WORKER_HYBRID_MODE === "shadow" ||
    env.RESUME_WORKER_HYBRID_MODE === "apply"
      ? env.RESUME_WORKER_HYBRID_MODE
      : "off";
  return {
    mode,
    hashes: (env.RESUME_WORKER_HYBRID_HASHES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-f0-9]{64}$/.test(s)),
    batches: (env.RESUME_WORKER_HYBRID_BATCH_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    newAfter: Date.parse(env.RESUME_WORKER_HYBRID_NEW_AFTER ?? ""),
  };
}
export interface HybridAdmission {
  acquire(
    identity: string,
  ): Promise<{ outcome: string; priorState?: string; transition?: (state: HybridAttemptState) => Promise<void>; release?: () => Promise<void> }>;
}
export const HYBRID_SLOT = "resume:hybrid:v1:slot";
// No expiry: a disconnected request may still be running in Ollama. On crash or
// uncertain cancellation, quarantine capacity until an operator verifies idle.
// Admission never waits. Attempt markers fence queue retries across processes.
export class RedisHybridAdmission implements HybridAdmission {
  constructor(private readonly redis: Redis) {}
  async acquire(identity: string) {
    const token = randomUUID();
    const result = Number(
      await this.redis.eval(
        `
      local prior = redis.call('get', KEYS[2])
      if prior and string.sub(prior, 1, 14) ~= 'v2:no_request:' then return 2 end
      if redis.call('exists', KEYS[1]) == 1 then return 0 end
      redis.call('set', KEYS[1], ARGV[1])
      redis.call('set', KEYS[2], 'v2:reserved:' .. ARGV[1])
      return 1`,
        2,
        HYBRID_SLOT,
        `resume:hybrid:v1:attempt:${identity}`,
        token,
      ),
    );
    return {
      priorState: result === 2 ? admissionMarkerState(await this.redis.get(`resume:hybrid:v1:attempt:${identity}`)) : undefined,
      transition: result === 1 ? async (state: HybridAttemptState) => {
        const changed = await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[2], ARGV[2]); return 1 end return 0",
          2, HYBRID_SLOT, `resume:hybrid:v1:attempt:${identity}`, token, `v2:${state.toLowerCase()}:${token}`);
        if (Number(changed) !== 1) throw new Error("HYBRID_ADMISSION_OWNERSHIP_LOST");
      } : undefined,
      outcome:
        result === 1
          ? "ADMITTED"
          : result === 2
            ? "ALREADY_ATTEMPTED"
            : "CAPACITY",
      release:
        result === 1
          ? async () => {
              await this.redis.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
                1,
                HYBRID_SLOT,
                token,
              );
            }
          : undefined,
    };
  }
}
export function admissionMarkerState(value: string | null) {
  const state = value?.split(":")[1];
  return value?.startsWith("v2:") && ["reserved", "request_intent", "no_request", "completed", "uncertain"].includes(state ?? "") ? state!.toUpperCase() : "LEGACY_UNKNOWN";
}
export interface WorkerHybridContext {
  resumeId: string;
  generation: number;
  fileHash: string;
  batchId: string | null;
  createdAt: Date;
  protectedCandidate: boolean;
  signal?: AbortSignal;
  checkOwnership: () => Promise<boolean>;
  claimAttempt?: () => Promise<boolean>;
  recordAttemptState?: (state: HybridAttemptState) => Promise<boolean>;
  // Isolated replay bypasses upload selection only, never admission or validation.
  replay?: boolean;
}
export interface WorkerHybridRuntime {
  admission: HybridAdmission;
  env?: NodeJS.ProcessEnv;
  adapter?: NuExtractAdapter;
}
export async function processWorkerHybrid(
  text: string,
  baseline: StructuredExtraction,
  context: WorkerHybridContext,
  runtime?: WorkerHybridRuntime,
) {
  const env = runtime?.env ?? process.env;
  const config = workerHybridConfig(env);
  const metrics: HybridResult["metrics"] = {
    calls: 0,
    requests: 0,
    targets: [],
    accepted: 0,
    rejected: 0,
    latencyMs: 0,
    failures: [],
    returnedValues: 0,
    nullValues: 0,
    emptyResponses: 0,
  };
  let outcome = "DISABLED",
    structured = baseline;
  let comparison: HybridResult | undefined;
  let phase = "selection", requestState = "NOT_STARTED", priorRequestState: string | undefined;
  let quarantined: boolean | undefined;
  let dispatched = 0, returnedRequests = 0;
  const diagnostic = (event: string, error?: unknown) => console.info(JSON.stringify({ event,
    resumeId: context.resumeId, generation: context.generation, mode: config.mode, stage: phase,
    admissionOutcome: outcome, requestState, requests: Math.max(metrics.requests, dispatched, returnedRequests),
    ...(error === undefined ? {} : { error: safeProcessingError(error) }) }));
  const selected =
    (context.replay && config.mode === "shadow") ||
    (Number.isFinite(config.newAfter) &&
      context.createdAt.getTime() >= config.newAfter &&
      (config.hashes.includes(context.fileHash.toLowerCase()) ||
        Boolean(context.batchId && config.batches.includes(context.batchId))));
  if (config.mode !== "off") {
    outcome =
      context.protectedCandidate && !context.replay
        ? "PROTECTED"
        : !selected
          ? "NOT_SELECTED"
          : "ADMISSION_UNAVAILABLE";
    if (selected && (!context.protectedCandidate || context.replay)) {
      structured = {
        ...baseline,
        warnings: [
          ...new Set([...baseline.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
        ],
      };
      let slot: Awaited<ReturnType<HybridAdmission["acquire"]>> | undefined;
      let safeToRelease = false;
      let reservedByUs = false, noRequestProven = true;
      const state = async (value: HybridAttemptState) => {
        if (context.recordAttemptState && !await context.recordAttemptState(value)) throw new Error("HYBRID_ATTEMPT_STATE_NOT_OWNED");
        await slot?.transition?.(value);
      };
      const reserve = async () => {
        phase = "durable_reservation";
        return context.claimAttempt ? context.claimAttempt() : true;
      };
      try {
        phase = "ownership_before_admission";
        if (context.signal?.aborted || !(await context.checkOwnership()))
          outcome = "OWNERSHIP_LOST";
        else if (runtime) {
          const adapter =
            runtime.adapter ??
            new NuExtractAdapter({ ...nuConfig(env), enabled: true });
          phase = "admission";
          slot = await runtime.admission.acquire(
            `${context.resumeId}:${context.generation}`,
          );
          outcome = slot.outcome;
          priorRequestState = slot.priorState;
          diagnostic("hybrid_admission");
          if (slot.release) {
            quarantined = true;
            safeToRelease = true;
            // Recheck after admission, before any model request.
            if (context.signal?.aborted || !(await context.checkOwnership())) {
              outcome = "OWNERSHIP_LOST";
              safeToRelease = true;
            } else if (!await reserve())
              outcome = "ALREADY_ATTEMPTED_OR_PROTECTED";
            else {
              reservedByUs = true;
              requestState = "RESERVED";
              diagnostic("hybrid_attempt_reserved");
              phase = "inference";
              safeToRelease = false;
              noRequestProven = false;
              comparison = await extractHybridResume(text, {
                baseline,
                adapter,
                signal: context.signal,
                requestLifecycle: {
                  beforeRequest: async () => {
                    phase = "request_intent";
                    if (context.signal?.aborted || !await context.checkOwnership()) throw new Error("HYBRID_OWNERSHIP_LOST");
                    await state("REQUEST_INTENT");
                    requestState = "REQUEST_INTENT";
                    diagnostic("hybrid_request_intent");
                  },
                  onDispatched: () => {
                    dispatched++;
                    requestState = "DISPATCHED";
                    phase = "inference";
                    diagnostic("hybrid_request_dispatched");
                  },
                },
                onOutcome: async (result, target) => {
                  metrics.calls++;
                  metrics.targets.push(target);
                  metrics.latencyMs += result.latencyMs;
                  if (result.invoked) returnedRequests++;
                  metrics.requests = Math.max(dispatched, returnedRequests);
                  noRequestProven = metrics.requests === 0;
                  if (result.invoked) {
                    requestState = result.ok ? "COMPLETED" : "UNCERTAIN";
                    phase = "request_state_persistence";
                    // Persist before merge/post-processing can fail. A failed
                    // state write leaves the durable intent fence in place.
                    await state(result.ok ? "COMPLETED" : "UNCERTAIN");
                  }
                  diagnostic(result.ok ? "hybrid_request_completed" : "hybrid_request_failed");
                  if (!result.ok) console.info(JSON.stringify({ event: "hybrid_model_failure", resumeId: context.resumeId,
                    generation: context.generation, stage: result.stage, outcome: result.reason, invoked: result.invoked,
                    requestState, httpStatus: result.httpStatus, error: result.error }));
                },
              });
              Object.assign(metrics, comparison.metrics);
              noRequestProven = metrics.requests === 0;
              safeToRelease = !metrics.requests || !metrics.failures.length;
              outcome =
                metrics.failures[0] ??
                (metrics.requests ? "COMPLETE" : "NO_REQUEST");
              phase = "post_inference_ownership";
              if (context.signal?.aborted || !(await context.checkOwnership()))
                outcome = "OWNERSHIP_LOST";
              else if (!metrics.failures.length && config.mode === "apply")
                structured = comparison.structured;
              else if (config.mode === "shadow") {
                // Shadow proposals stay observations; no candidate/basic merge.
                structured = {
                  ...structured,
                  evidence: [
                    ...structured.evidence,
                    ...comparison.structured.evidence
                      .filter((e) => e.signals.includes("LOCAL_NUEXTRACT"))
                      .map((e) => ({
                        ...e,
                        fieldPath: "observed.hybrid." + e.fieldPath,
                      })),
                  ],
                };
              }
            }
          }
        }
      } catch (error) {
        outcome = "DEPENDENCY_FAILURE";
        metrics.requests = Math.max(metrics.requests, dispatched, returnedRequests);
        // A completed request can release capacity, but remains fenced against
        // another inference even when unrelated post-processing fails.
        safeToRelease = requestState === "COMPLETED" || noRequestProven;
        diagnostic("hybrid_processing_failed", error);
      } finally {
        if (reservedByUs && noRequestProven) {
          try {
            phase = "no_request_proof";
            await state("NO_REQUEST");
            requestState = "NO_REQUEST";
            safeToRelease = true;
          } catch (error) {
            safeToRelease = false;
            diagnostic("hybrid_state_recording_failed", error);
          }
        }
        if (safeToRelease && slot?.release) {
          try {
            await slot.release();
            quarantined = false;
          } catch (error) {
            outcome = "ADMISSION_QUARANTINED";
            diagnostic("hybrid_release_failed", error);
          }
        }
        diagnostic("hybrid_phase_finished");
      }
      // Failure always returns the complete deterministic baseline, with review.
      structured = {
        ...structured,
        warnings: [
          ...new Set([...structured.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
        ],
      };
    }
  }
  const execution = {
    mode: config.mode,
    enabled: config.mode !== "off",
    invoked: metrics.requests > 0,
    requests: metrics.requests,
    targets: metrics.targets,
    accepted: metrics.accepted,
    rejected: metrics.rejected,
    returnedValues: metrics.returnedValues,
    nullValues: metrics.nullValues,
    emptyResponses: metrics.emptyResponses,
    reasonCounts: (comparison?.diagnostics ?? []).reduce<Record<string, number>>((counts, d) => {
      counts[d.reason] = (counts[d.reason] ?? 0) + 1;
      return counts;
    }, {}),
    proposalEvidence: comparison?.structured.evidence.filter(e => e.signals.includes("LOCAL_NUEXTRACT")).length ?? 0,
    retainedEvidence: structured.evidence.filter(e => e.signals.includes("LOCAL_NUEXTRACT")).length,
    inferenceMs: Math.round(metrics.latencyMs),
    outcome,
    requestState,
    priorRequestState,
    quarantined,
    requiresReview: structured.warnings.includes("EXPERIMENTAL_HYBRID_REVIEW"),
  };
  // Evidence text is capped at 500 characters by persistence. Keep each JSON
  // record small so diagnostic additions cannot silently truncate it.
  const { returnedValues, nullValues, emptyResponses, reasonCounts, proposalEvidence, retainedEvidence, ...lifecycleExecution } = execution;
  if (config.mode !== "off" && selected)
    structured = {
      ...structured,
      evidence: [
        ...structured.evidence,
        {
          fieldPath: "processing.hybrid",
          sourceSection: "processing",
          text: JSON.stringify(lifecycleExecution),
          confidence: 0,
          location: { page: 1, lineStart: 1, lineEnd: 1 },
          signals: ["EXPERIMENTAL_WORKER_HYBRID", "REQUIRES_HUMAN_REVIEW"],
        },
        {
          fieldPath: "processing.hybrid.quality",
          sourceSection: "processing",
          text: JSON.stringify({ returnedValues, nullValues, emptyResponses, proposalEvidence, retainedEvidence }),
          confidence: 0,
          location: { page: 1, lineStart: 1, lineEnd: 1 },
          signals: ["EXPERIMENTAL_WORKER_HYBRID", "REQUIRES_HUMAN_REVIEW"],
        },
        ...Object.entries(reasonCounts).map(([reason, count]) => ({
          fieldPath: "processing.hybrid.reason." + reason,
          sourceSection: "processing",
          text: String(count),
          confidence: 0,
          location: { page: 1, lineStart: 1, lineEnd: 1 },
          signals: ["EXPERIMENTAL_WORKER_HYBRID", "REQUIRES_HUMAN_REVIEW"],
        })),
      ],
    };
  return { structured, comparison, execution };
}
