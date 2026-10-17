import { Worker } from "node:worker_threads";
import { createServer, type Server } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { emitDiagnostic } from "./runtime-diagnostics";
import { decodeExecution, executionRequest, EXECUTION_VERSION, EXECUTION_DEADLINE_MS, type ExecutionResult } from "./resume-execution-contract";

// One extraction per host/network namespace, including independent coordinators.
// No stale lock files or expiring distributed lease that could overlap live work.
const EXTRACTION_PORT = 43189;
async function acquireLane(signal: AbortSignal): Promise<Server> {
  for (;;) {
    signal.throwIfAborted();
    const server = createServer(socket => socket.destroy());
    const acquired = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
      server.listen({ host: "127.0.0.1", port: EXTRACTION_PORT, exclusive: true }, () => resolve(true));
    });
    if (acquired) {
      if (signal.aborted) { server.close(); signal.throwIfAborted(); }
      return server;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 100);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}

export interface ExecutionOptions { signal?: AbortSignal; onPhase?: (stage: "deterministic_extraction") => void }
// Worker file and shorter deadline are injectable for isolated fault tests only.
export class ResumeExecutionLane {
  constructor(private readonly workerFile = path.resolve("apps/worker/src/extraction-thread.cjs"),
    private readonly deadlineMs = EXECUTION_DEADLINE_MS) {}

  async extract(filePath: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const started = performance.now();
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason ?? new Error("EXECUTION_CANCELLED"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(() => {
      emitDiagnostic("execution_deadline", { elapsedMs: performance.now() - started });
      controller.abort(Object.assign(new Error("EXECUTION_DEADLINE"), { name: "DocumentTimeoutError" }));
    }, this.deadlineMs);
    let lane: Server | undefined;
    let child: Worker | undefined;
    let succeeded = false;
    try {
      lane = await acquireLane(controller.signal);
      controller.signal.throwIfAborted();
      const input = executionRequest.parse({ version: EXECUTION_VERSION, id: randomUUID(), filePath });
      child = new Worker(this.workerFile, { workerData: input, execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        // Reader dependencies must never print source material to coordinator logs.
        stdout: true, stderr: true,
      });
      child.stdout.resume(); child.stderr.resume();
      emitDiagnostic("execution_started", { elapsedMs: performance.now() - started });
      const active = child;
      const result = await new Promise<ExecutionResult>((resolve, reject) => {
        let settled = false;
        let messages = 0;
        const finish = (error?: unknown, value?: ExecutionResult) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", abort);
          if (value === undefined) reject(error ?? new Error("EXECUTION_FAILED")); else resolve(value);
        };
        const abort = () => finish(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        active.on("message", message => {
          if (settled) return;
          if (controller.signal.aborted) { abort(); return; }
          try {
            if (++messages > 2) throw new Error("EXECUTION_MESSAGE_COUNT");
            const response = decodeExecution(message);
            if (response.id !== input.id) throw new Error("EXECUTION_ID_MISMATCH");
            if (response.ok === "phase") { options.onPhase?.(response.stage); return; }
            if (!response.ok) {
              const error = Object.assign(new Error("EXTRACTION_FAILED"), { name: response.name, code: response.code,
                reason: response.reason });
              finish(error);
            } else finish(undefined, response);
          } catch { finish(new Error("EXECUTION_PROTOCOL_ERROR")); }
        });
        active.once("error", () => finish(new Error("EXECUTION_CRASH")));
        active.once("exit", () => finish(new Error("EXECUTION_EXIT")));
        if (controller.signal.aborted) abort();
      });
      controller.signal.throwIfAborted();
      succeeded = true;
      return result;
    } catch (error) {
      const e = error as { message?: string; reason?: string; name?: string };
      const executionFailure = controller.signal.aborted
        ? e.name === "DocumentTimeoutError" ? "deadline" : "cancelled"
        : e.message === "EXECUTION_CRASH" ? "crash"
        : e.message === "EXECUTION_EXIT" ? "exit"
        : e.message === "EXECUTION_PROTOCOL_ERROR" ? "protocol"
        : e.reason === "STRUCTURED_EXTRACTION_FAILED" ? "parser"
        : e.message === "EXTRACTION_FAILED" ? "reader" : "unavailable";
      emitDiagnostic("execution_failed", { executionFailure, elapsedMs: performance.now() - started });
      throw error;
    } finally {
      clearTimeout(timer);
      // Await termination before releasing host capacity, even after success.
      try { if (child) await child.terminate(); }
      finally {
        if (lane) await new Promise<void>(resolve => lane!.close(() => resolve()));
        options.signal?.removeEventListener("abort", cancel);
        emitDiagnostic("execution_terminated", { elapsedMs: performance.now() - started, aborted: controller.signal.aborted,
          outcome: succeeded && !controller.signal.aborted ? "success" : "error", ...(controller.signal.aborted ? {
            cancellationReason: (controller.signal.reason as Error)?.name === "DocumentTimeoutError" ? "deadline" : "parent",
          } : {}) });
        if (succeeded) controller.signal.throwIfAborted();
      }
    }
  }
}
export const resumeExecution = new ResumeExecutionLane();
