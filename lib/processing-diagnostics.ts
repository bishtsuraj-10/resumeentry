// Never return error.message, stack, arbitrary names/codes, URLs or SQL metadata.
export function safeProcessingError(error: unknown) {
  const value = error as { name?: string; code?: string; reason?: string; message?: string; cause?: unknown; meta?: { code?: string } } | null;
  const codes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOENT", "EACCES", "EIO", "ENOMEM", "ENOSPC", "P1001", "P1002", "P1008", "P1017", "P2002", "P2003", "P2010", "P2024", "P2025", "P2028", "P2034", "40001", "40P01", "53300", "57014", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"];
  const names = ["Error", "TypeError", "RangeError", "SyntaxError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientValidationError", "AbortError", "TimeoutError", "InvalidPDFException", "PasswordException", "FormatError", "DocumentLimitError", "PermanentProcessingError"];
  let code = codes.includes(value?.code ?? "") ? value!.code! : "UNKNOWN";
  if (["FILE_HASH_MISMATCH", "UNSUPPORTED_FORMAT", "EMPTY_DOCUMENT", "STRUCTURED_EXTRACTION_FAILED", "INVALID_DOCUMENT"].includes(value?.reason ?? "")) code = value!.reason!;
  const name = names.includes(value?.name ?? "") ? value!.name! : "UNKNOWN";
  const message = typeof value?.message === "string" ? value.message : "";
  if (code === "UNKNOWN") {
    if (/Missing lock for job/i.test(message)) code = "BULLMQ_MISSING_LOCK";
    else if (/Lock mismatch for job/i.test(message)) code = "BULLMQ_LOCK_MISMATCH";
    else if (/could not renew lock/i.test(message)) code = "BULLMQ_LOCK_RENEWAL";
    else if (/^Command timed out\.?$/i.test(message)) code = "REDIS_COMMAND_TIMEOUT";
    else if (/^Stream isn't writeable and enableOfflineQueue options is false$/.test(message)) code = "REDIS_NOT_READY";
    else if (/^Resume processing failed; retry scheduled\.$/.test(message)) code = "PROCESSING_RETRY";
  }
  const cause = value?.cause as { code?: string } | undefined;
  return { category: name.startsWith("Prisma") || /^P\d/.test(code) ? "DATABASE" :
    ["FILE_HASH_MISMATCH", "UNSUPPORTED_FORMAT", "EMPTY_DOCUMENT", "STRUCTURED_EXTRACTION_FAILED", "INVALID_DOCUMENT"].includes(code) || ["InvalidPDFException", "PasswordException", "FormatError", "DocumentLimitError"].includes(name) ? "DOCUMENT" :
    code.startsWith("BULLMQ") ? "QUEUE_LOCK" : code.startsWith("REDIS") ? "REDIS" :
    /^E|^UND_ERR/.test(code) ? "IO" : name === "AbortError" || name === "TimeoutError" ? "CANCELLATION" :
    ["TypeError", "RangeError", "SyntaxError"].includes(name) ? "RUNTIME" : "UNKNOWN",
    code, name, causeCode: codes.includes(cause?.code ?? "") ? cause!.code! : "UNKNOWN",
    databaseCode: codes.includes(value?.meta?.code ?? "") ? value!.meta!.code! : "UNKNOWN" };
}
