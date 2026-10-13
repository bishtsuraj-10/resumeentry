import { ZodError } from "zod";
import { CandidateDataError } from "./candidate-data";

export async function readCandidateBody(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new CandidateDataError(415, "Use application/json.");
  const limit = 256 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new CandidateDataError(413, "Candidate update is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new CandidateDataError(400, "Invalid candidate update.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new CandidateDataError(413, "Candidate update is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof CandidateDataError) throw error;
    throw new CandidateDataError(400, "Invalid candidate update.");
  } finally {
    reader.releaseLock();
  }
}

export function candidateErrorResponse(error: unknown) {
  if (error instanceof CandidateDataError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json({ error: "Invalid candidate data." }, { status: 400 });
  return Response.json(
    { error: "Candidate operation failed." },
    { status: 500 },
  );
}

export function publicResume<T extends { fileSize: bigint }>(resume: T) {
  return {
    ...Object.fromEntries(
      Object.entries(resume).filter(
        ([key]) =>
          !["filePath", "claimToken", "leaseUntil", "scheduleAfter"].includes(
            key,
          ),
      ),
    ),
    fileSize: Number(resume.fileSize),
  };
}
