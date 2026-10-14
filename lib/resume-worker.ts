import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { extractStructuredResume, LocalResumeParser } from "./resume-parser";
import {
  claimResume,
  classifyError,
  failResume,
  finalizeResume,
  leaseMs,
  PermanentProcessingError,
  renewClaim,
} from "./processing";

const parser = new LocalResumeParser();
export async function runResumeJob(
  db: PrismaClient,
  data: { resumeId: string; generation?: number },
) {
  const resume = await claimResume(db, data.resumeId, data.generation ?? 0);
  if (!resume?.claimToken) return "skipped";
  const token = resume.claimToken;
  let lost = false;
  const controller = new AbortController();
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (lost || renewing) return;
    renewing = renewClaim(db, resume.id, token)
      .then((valid) => {
        if (!valid) {
          lost = true;
          controller.abort();
        }
      })
      .catch(() => {
        lost = true;
        controller.abort();
      })
      .finally(() => {
        renewing = undefined;
      });
  }, leaseMs / 3);
  const check = async () => !lost && (await renewClaim(db, resume.id, token));
  try {
    if (!parser.canParse(`.${resume.fileType}`))
      throw new PermanentProcessingError("UNSUPPORTED_FORMAT");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resume.filePath)) {
      if (lost) return "skipped";
      hash.update(chunk);
    }
    if (hash.digest("hex") !== resume.fileHash)
      throw new PermanentProcessingError("FILE_HASH_MISMATCH");
    if (!(await check())) return "skipped";
    const document = await parser.extractText(resume.filePath, {
      signal: controller.signal,
    });
    const { text, usedOcr } = document;
    if (!(await check())) return "skipped";
    if (!text.trim()) throw new PermanentProcessingError("EMPTY_DOCUMENT");
    const structured = extractStructuredResume(text, {
      documentWarnings: document.warnings,
    });
    const extraction = structured.basic;
    if (!(await check())) return "skipped";
    extraction.overallConfidence =
      (extraction.nameConfidence +
        extraction.emailConfidence +
        extraction.phoneConfidence +
        extraction.designationConfidence) /
      4;
    const finalized = await finalizeResume(
      db,
      resume.id,
      token,
      extraction,
      {
        parserVersion: structured.parserVersion,
        startedAt: resume.updatedAt,
        method: "LOCAL",
        structured,
      },
    );
    if (finalized)
      console.info(
        JSON.stringify({
          event: "resume_processing_completed",
          resumeId: resume.id,
          usedOcr,
          ocrPages: document.ocrPages,
          documentMs: document.durationMs,
          extractionMs: Math.round(structured.durationMs),
          warningCount: structured.warnings.length,
        }),
      );
    return finalized ? "completed" : "skipped";
  } catch (error) {
    const recorded = await failResume(db, resume.id, token, error);
    if (!recorded) return "skipped";
    console.error(
      JSON.stringify({
        event: "resume_processing_failed",
        resumeId: resume.id,
        attempt: resume.processingAttempts,
        type: classifyError(error).type,
      }),
    );
    return classifyError(error).permanent ? "permanent" : "retry";
  } finally {
    clearInterval(timer);
    await renewing;
  }
}
