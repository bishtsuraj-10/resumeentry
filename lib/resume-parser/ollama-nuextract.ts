import { emitDiagnostic, ollamaNumericTimings, withRequestDiagnostics } from "../runtime-diagnostics";
import { z } from "zod";
import { safeProcessingError } from "../processing-diagnostics";

const value = z.string().trim().min(1).max(20000).nullable();
const list = <T extends z.ZodType>(item: T) => z.array(item).max(20);
const period = { start_date: value, end_date: value, source_quote: value };
export const nuSchemas = {
  professional: z.strictObject({
    current_designation: value,
    location: value,
    summary: value,
  }),
  identity: z.strictObject({ name: value, email: value, phone: value }),
  skillsLinks: z.strictObject({ skills: list(value), links: list(value) }),
  employment: z.strictObject({
    employment: list(
      z.strictObject({ employer: value, designation: value, ...period }),
    ),
  }),
  education: z.strictObject({
    education: list(
      z.strictObject({ degree: value, institution: value, ...period }),
    ),
    certifications: list(
      z.strictObject({ name: value, issuer: value, source_quote: value }),
    ),
  }),
};
export type NuTarget = keyof typeof nuSchemas;
export const nuTemplates: Record<NuTarget, unknown> = {
  professional: {
    current_designation: "verbatim-string",
    location: "verbatim-string",
    summary: "verbatim-string",
  },
  identity: {
    name: "verbatim-string",
    email: "verbatim-string",
    phone: "verbatim-string",
  },
  skillsLinks: { skills: ["verbatim-string"], links: ["verbatim-string"] },
  employment: {
    employment: [
      {
        employer: "verbatim-string",
        designation: "verbatim-string",
        start_date: "verbatim-string",
        end_date: "verbatim-string",
        source_quote: "verbatim-string",
      },
    ],
  },
  education: {
    education: [
      {
        degree: "verbatim-string",
        institution: "verbatim-string",
        start_date: "verbatim-string",
        end_date: "verbatim-string",
        source_quote: "verbatim-string",
      },
    ],
    certifications: [
      {
        name: "verbatim-string",
        issuer: "verbatim-string",
        source_quote: "verbatim-string",
      },
    ],
  },
};
export interface NuConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  timeoutMs: number;
  contextTokens: number;
  outputTokens: number;
  maxInputChars: number;
  maxCalls: number;
  documentBudgetMs: number;
}
const integer = (
  v: string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Number(v ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("INVALID_NUEXTRACT_CONFIG");
  return n;
};
export function nuConfig(env: NodeJS.ProcessEnv = process.env): NuConfig {
  const config = {
    enabled: env.RESUME_HYBRID_ENABLED === "true",
    endpoint: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model:
      env.OLLAMA_NUEXTRACT_MODEL ?? "hf.co/numind/NuExtract-2.0-2B-GGUF:Q4_K_M",
    timeoutMs: integer(env.NUEXTRACT_TIMEOUT_MS, 60000, 100, 120000),
    contextTokens: integer(env.NUEXTRACT_CONTEXT_TOKENS, 2048, 1024, 8192),
    outputTokens: integer(env.NUEXTRACT_OUTPUT_TOKENS, 384, 64, 2048),
    maxInputChars: integer(env.NUEXTRACT_MAX_INPUT_CHARS, 1200, 200, 12000),
    maxCalls: integer(env.NUEXTRACT_MAX_CALLS, 2, 1, 8),
    documentBudgetMs: integer(
      env.NUEXTRACT_DOCUMENT_BUDGET_MS,
      90000,
      100,
      300000,
    ),
  };
  localEndpoint(config.endpoint);
  if (config.outputTokens + 512 >= config.contextTokens || !config.model.trim())
    throw new Error("INVALID_NUEXTRACT_CONFIG");
  return config;
}
function localEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]", "host.docker.internal"].includes(
      url.hostname,
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("LOCAL_OLLAMA_ENDPOINT_REQUIRED");
  return url;
}
export interface NuRequestLifecycle {
  beforeRequest?: () => Promise<void>;
  onDispatched?: () => void;
}
export type NuOutcome =
  | {
      ok: true;
      invoked: boolean;
      data: Record<string, unknown>;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { ok: false; invoked: boolean; reason: string; latencyMs: number; stage?: string; httpStatus?: number; error?: ReturnType<typeof safeProcessingError> };
// Process-wide admission control: no waiting queue that can outlive document leases.
// Multiple host processes still require an Ollama server configured for one runner.
let busy = false;
export class NuExtractAdapter {
  constructor(
    readonly config: NuConfig = nuConfig(),
    private readonly transport: typeof fetch = fetch,
  ) {
    localEndpoint(config.endpoint);
  }
  async extract(
    target: NuTarget,
    source: string,
    signal?: AbortSignal,
    budgetMs = this.config.timeoutMs,
    lifecycle?: NuRequestLifecycle,
  ): Promise<NuOutcome> {
    return withRequestDiagnostics(() => this.extractObserved(target, source, signal, budgetMs, lifecycle));
  }
  private async extractObserved(target: NuTarget, source: string, signal: AbortSignal | undefined, budgetMs: number, lifecycle?: NuRequestLifecycle): Promise<NuOutcome> {
    const started = performance.now();
    let serverTimings: Record<string, number> = {};
    const requestSettings = {
      requestTimeoutMs: this.config.timeoutMs, documentBudgetMs: this.config.documentBudgetMs,
      contextTokens: this.config.contextTokens, outputTokens: this.config.outputTokens,
      maxInputChars: this.config.maxInputChars, maxCalls: this.config.maxCalls, remainingBudgetMs: budgetMs,
    };
    let invoked = false;
    let stage = "preflight";
    let httpStatus: number | undefined;
    const failure = (reason: string, error?: unknown): NuOutcome => {
      const elapsedMs = performance.now() - started;
      emitDiagnostic("ollama_request_finished", { ...requestSettings, ...serverTimings, target, stage, outcome: reason, invoked, clientElapsedMs: elapsedMs, httpStatus, aborted: reason === "ABORTED" || reason === "TIMEOUT", error });
      return {
        ok: false,
        invoked,
        reason,
        latencyMs: elapsedMs,
        stage,
        httpStatus,
        ...(error === undefined ? {} : { error: safeProcessingError(error) }),
      };
    };
    if (!this.config.enabled) return failure("DISABLED");
    if (busy) return failure("BUSY");
    const limit = Math.min(
      this.config.maxInputChars,
      (this.config.contextTokens - this.config.outputTokens - 512) * 2,
    );
    if (!source.trim() || source.length > limit) return failure("INPUT_BUDGET");
    if (signal?.aborted) return failure("ABORTED");
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      abort,
      Math.min(this.config.timeoutMs, Math.max(1, budgetMs)),
    );
    try {
      // tags is read-only; no pull/create/download endpoint is ever called.
      const tags = await this.transport(
        new URL("/api/tags", this.config.endpoint),
        { signal: controller.signal, redirect: "error" },
      );
      httpStatus = tags.status;
      if (!tags.ok) return failure("UNAVAILABLE");
      const inventory = (await tags.json()) as {
        models?: {
          name?: string;
          model?: string;
          size?: number;
          remote_host?: string;
          remote_model?: string;
        }[];
      };
      const installed = inventory.models?.find(
        (m) => (m.name ?? m.model) === this.config.model,
      );
      if (!installed || !installed.size || installed.size < 0)
        return failure("MODEL_NOT_INSTALLED");
      if (
        installed.remote_host ||
        installed.remote_model ||
        /(?:^|[:/-])cloud(?:$|[:/-])/i.test(this.config.model)
      )
        return failure("REMOTE_MODEL_REJECTED");
      // Official NuExtract 2.0 ChatML framing. No Ollama JSON grammar override.
      const escape = (text: string) =>
        text.replace(/<\|/g, "< | ").replace(/\|>/g, " | >");
      const prompt = `<|im_start|>user\n# Template:\n${JSON.stringify(nuTemplates[target])}\n# Context:\n${escape(source)}<|im_end|>\n<|im_start|>assistant\n`;
      // Persist intent before crossing the HTTP boundary. A failed guard or a
      // signal lost while awaiting it must never send the generate request.
      stage = "dispatch_guard";
      await lifecycle?.beforeRequest?.();
      if (controller.signal.aborted) return failure(signal?.aborted ? "ABORTED" : "TIMEOUT");
      invoked = true;
      stage = "generate";
      httpStatus = undefined;
      lifecycle?.onDispatched?.();
      const response = await this.transport(
        new URL("/api/generate", this.config.endpoint),
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            raw: true,
            stream: false,
            keep_alive: "30s",
            options: {
              temperature: 0,
              seed: 0,
              num_ctx: this.config.contextTokens,
              num_predict: this.config.outputTokens,
              num_thread: 2,
            },
          }),
        },
      );
      httpStatus = response.status;
      if (!response.ok) return failure("UNAVAILABLE");
      stage = "response_read";
      // Bound streamed bytes even if a server ignores num_predict.
      const reader = response.body?.getReader();
      if (!reader) return failure("MALFORMED_RESPONSE");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 256000) {
            await reader.cancel();
            return failure("RESPONSE_BUDGET");
          }
          parts.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      stage = "response_validation";
      const envelope = JSON.parse(Buffer.concat(parts).toString("utf8"));
      serverTimings = ollamaNumericTimings(envelope);
      if (envelope.done !== true || envelope.done_reason === "length")
        return failure("TRUNCATED_RESPONSE");
      if (typeof envelope.response !== "string")
        return failure("MALFORMED_RESPONSE");
      if (!envelope.response.trim()) return failure("EMPTY_MODEL_RESPONSE");
      const decoded: unknown = JSON.parse(envelope.response.trim());
      if (decoded === null) return failure("NULL_MODEL_OUTPUT");
      const parsed = nuSchemas[target].safeParse(
        decoded,
      );
      if (!parsed.success) return failure("SCHEMA_REJECTED");
      const latencyMs = performance.now() - started;
      emitDiagnostic("ollama_request_finished", { ...requestSettings, ...serverTimings, target, stage: "complete", outcome: "success", invoked, clientElapsedMs: latencyMs, httpStatus });
      return {
        ok: true,
        invoked,
        data: parsed.data,
        latencyMs,
        inputTokens: envelope.prompt_eval_count,
        outputTokens: envelope.eval_count,
      };
    } catch (error) {
      return failure(
        controller.signal.aborted
          ? signal?.aborted
            ? "ABORTED"
            : "TIMEOUT"
          : "INVALID_RESPONSE_OR_UNAVAILABLE", error,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      busy = false;
    }
  }
}
