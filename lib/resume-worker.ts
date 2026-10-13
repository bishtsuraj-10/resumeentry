import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  ConfiguredAIParser,
  extractResumeFields,
  LocalResumeParser,
} from "./resume-parser";
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
const aiParser = new ConfiguredAIParser();
export async function runResumeJob(
  db: PrismaClient,
  data: { resumeId: string; generation?: number },
) {
  const resume = await claimResume(db, data.resumeId, data.generation ?? 0);
  if (!resume?.claimToken) return "skipped";
  const token = resume.claimToken;
  let lost = false;
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (lost || renewing) return;
    renewing = renewClaim(db, resume.id, token)
      .then((valid) => {
        if (!valid) lost = true;
      })
      .catch(() => {
        lost = true;
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
    const { text, usedOcr } = await parser.extractText(resume.filePath);
    if (!(await check())) return "skipped";
    if (!text.trim()) throw new PermanentProcessingError("EMPTY_DOCUMENT");
    const extraction = extractResumeFields(text, resume.fileName);
    let assisted = false;
    try {
      const ai =
        extraction.nameConfidence < 0.6 ||
        extraction.designationConfidence < 0.6
          ? await aiParser.parseResume(text)
          : {};
      if (ai.name && extraction.nameConfidence < 0.6) {
        assisted = true;
        extraction.name = ai.name;
        extraction.nameConfidence = 0.8;
      }
      if (ai.designation && extraction.designationConfidence < 0.6) {
        assisted = true;
        extraction.designation = ai.designation;
        extraction.designationConfidence = 0.8;
      }
    } catch {
      console.warn(
        JSON.stringify({ event: "ai_parsing_failed", resumeId: resume.id }),
      );
    }
    if (!(await check())) return "skipped";
    extraction.overallConfidence =
      (extraction.nameConfidence +
        extraction.emailConfidence +
        extraction.phoneConfidence +
        extraction.designationConfidence) /
      4;
    const threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 75) / 100;
    const requiresReview =
      extraction.overallConfidence < threshold ||
      !extraction.name ||
      !extraction.email ||
      !extraction.phone ||
      !extraction.designation;
    const finalized = await finalizeResume(
      db,
      resume.id,
      token,
      extraction,
      requiresReview,
      {
        parserVersion: "local-basic-v1",
        startedAt: resume.updatedAt,
        method: assisted ? "HYBRID" : "LOCAL",
      },
    );
    if (finalized)
      console.info(
        JSON.stringify({
          event: "resume_processing_completed",
          resumeId: resume.id,
          usedOcr,
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
