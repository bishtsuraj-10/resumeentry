import { z } from "zod";
import { candidatePatchSchema } from "./candidate-validation";
import type { StructuredExtraction } from "./resume-parser/index";

export const EXECUTION_VERSION = 1;
export const EXECUTION_DEADLINE_MS = 120_000;
export const MAX_EXECUTION_MESSAGE_BYTES = 8 * 1024 * 1024;
const duration = z.number().finite().nonnegative();
const strings = z.array(z.string().max(200000)).max(1500);
export const executionRequest = z.object({
  version: z.literal(EXECUTION_VERSION), id: z.string().uuid(),
  filePath: z.string().min(1).max(32768),
}).strict();
const confidence = z.number().finite().min(0).max(1);
const nullable = z.string().max(200000).nullable();
export const executionResponse = z.discriminatedUnion("ok", [
  z.object({ version: z.literal(EXECUTION_VERSION), id: z.string().uuid(), ok: z.literal("phase"),
    stage: z.literal("deterministic_extraction") }).strict(),
  z.object({ version: z.literal(EXECUTION_VERSION), id: z.string().uuid(), ok: z.literal(true),
    document: z.object({ text: z.string().max(200000), usedOcr: z.boolean(),
      ocrPages: z.number().int().min(0).max(25), pageCount: z.number().int().min(1).max(25),
      warnings: strings, durationMs: duration }).strict(),
    structured: z.object({ basic: z.object({ name: nullable, nameConfidence: confidence,
      email: nullable, emailConfidence: confidence, phone: nullable, countryCode: nullable,
      normalizedPhone: nullable, phoneConfidence: confidence, designation: nullable,
      designationConfidence: confidence, overallConfidence: confidence }).strict(),
    // Validate with the existing contract without applying its transforms again.
    candidate: z.custom<StructuredExtraction["candidate"]>(value => !!value && typeof value === "object" &&
      candidatePatchSchema.safeParse({ ...value, expectedRevision: 0 }).success),
    evidence: z.array(z.object({ fieldPath: z.string().max(1000), sourceSection: z.string().max(1000),
      text: z.string().max(500), location: z.object({ page: z.number().int().nonnegative(),
        lineStart: z.number().int().nonnegative(), lineEnd: z.number().int().nonnegative() }).strict(),
      confidence, signals: strings }).strict()).max(1500),
    warnings: strings, durationMs: duration, parserVersion: z.string().max(200) }).strict(),
  }).strict(),
  z.object({ version: z.literal(EXECUTION_VERSION), id: z.string().uuid(), ok: z.literal(false),
    name: z.enum(["Error", "InvalidPDFException", "PasswordException", "FormatError", "DocumentLimitError", "DocumentTimeoutError"]),
    code: z.enum(["UNKNOWN", "ENOENT", "EIO", "EACCES", "ENOMEM", "ENOSPC"]),
    reason: z.enum(["READER_FAILED", "EMPTY_DOCUMENT", "STRUCTURED_EXTRACTION_FAILED", "MESSAGE_LIMIT"]),
  }).strict(),
]);
export type ExecutionResult = Extract<z.infer<typeof executionResponse>, { ok: true }>;
export function encodeExecution(value: unknown) {
  const message = JSON.stringify(value);
  if (Buffer.byteLength(message) > MAX_EXECUTION_MESSAGE_BYTES) throw new Error("EXECUTION_MESSAGE_LIMIT");
  return message;
}
export function decodeExecution(message: unknown) {
  if (typeof message !== "string" || Buffer.byteLength(message) > MAX_EXECUTION_MESSAGE_BYTES)
    throw new Error("EXECUTION_MESSAGE_LIMIT");
  return executionResponse.parse(JSON.parse(message));
}
