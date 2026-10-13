import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfiguredAIParser } from "../lib/resume-parser";
import {
  classifyError,
  isTransactionConflict,
  PermanentProcessingError,
} from "../lib/processing";
import { processingJobId } from "../lib/processing-queue";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("processing policy", () => {
  it("recognizes Prisma adapter serialization and deadlock variants", () => {
    for (const error of [
      { code: "P2034" },
      { code: "P2010", meta: { code: "40P01" } },
      { cause: { kind: "TransactionWriteConflict" } },
      { cause: { originalCode: "40001" } },
    ]) {
      expect(isTransactionConflict(error)).toBe(true);
    }
    expect(isTransactionConflict({ code: "P2002" })).toBe(false);
    expect(isTransactionConflict(null)).toBe(false);
  });
  it("keeps configured remote AI disabled without explicit opt-in", async () => {
    vi.stubEnv("AI_PROVIDER", "configured");
    vi.stubEnv("AI_API_KEY", "synthetic");
    vi.stubEnv("AI_API_URL", "https://example.invalid");
    vi.stubEnv("AI_PARSING_ENABLED", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await new ConfiguredAIParser().parseResume("synthetic")).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("classifies document validation and PDF corruption as permanent", () => {
    expect(classifyError(new PermanentProcessingError()).permanent).toBe(true);
    expect(
      classifyError(Object.assign(new Error(), { name: "InvalidPDFException" }))
        .permanent,
    ).toBe(true);
  });
  it("bounds unknown and dependency failures through retry policy without exposing input", () => {
    for (const code of ["ECONNRESET", "ENOENT", "EIO", "P1001", undefined]) {
      const result = classifyError(
        Object.assign(new Error("private document content"), { code }),
      );
      expect(result.permanent).toBe(false);
      expect(result.message).not.toContain("private");
    }
  });
  it("uses stable identifiers within a generation and changes them on explicit retry", () => {
    expect(processingJobId("resume", 2)).toBe("resume-g2");
    expect(processingJobId("resume", 1)).not.toBe(processingJobId("resume", 2));
  });
});
