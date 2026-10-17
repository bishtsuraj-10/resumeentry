import { parentPort, workerData } from "node:worker_threads";
import { executionRequest, executionResponse, encodeExecution, EXECUTION_VERSION } from "../../../lib/resume-execution-contract";
import { LocalResumeParser } from "../../../lib/resume-parser/document-reader";
import { extractStructuredResume } from "../../../lib/resume-parser/index";

async function execute() {
  const input = executionRequest.parse(workerData);
  let reason = "READER_FAILED" as "READER_FAILED" | "EMPTY_DOCUMENT" | "STRUCTURED_EXTRACTION_FAILED" | "MESSAGE_LIMIT";
  try {
    const document = await new LocalResumeParser().extractText(input.filePath);
    reason = "EMPTY_DOCUMENT";
    if (!document.text.trim()) throw new Error(reason);
    reason = "STRUCTURED_EXTRACTION_FAILED";
    parentPort!.postMessage(encodeExecution({ version: EXECUTION_VERSION, id: input.id, ok: "phase", stage: "deterministic_extraction" }));
    const structured = extractStructuredResume(document.text, { documentWarnings: document.warnings });
    reason = "MESSAGE_LIMIT";
    parentPort!.postMessage(encodeExecution(executionResponse.parse({
      version: EXECUTION_VERSION, id: input.id, ok: true, document, structured,
    })));
  } catch (error) {
    const e = error as { name?: string; code?: string };
    parentPort!.postMessage(encodeExecution({ version: EXECUTION_VERSION, id: input.id, ok: false,
      name: ["InvalidPDFException", "PasswordException", "FormatError", "DocumentLimitError", "DocumentTimeoutError"].includes(e.name ?? "") ? e.name : "Error",
      code: ["ENOENT", "EIO", "EACCES", "ENOMEM", "ENOSPC"].includes(e.code ?? "") ? e.code : "UNKNOWN", reason,
    }));
  }
}
void execute();
