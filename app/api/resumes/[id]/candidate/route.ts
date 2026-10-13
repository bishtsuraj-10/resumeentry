import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { patchCandidate, readCandidate } from "@/lib/candidate-data";
import {
  candidateErrorResponse,
  readCandidateBody,
} from "@/lib/candidate-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireApiSession("resumes.view", request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  try {
    const result = await readCandidate(db, id);
    return result
      ? Response.json(result, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "Resume not found." }, { status: 404 });
  } catch (error) {
    return candidateErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireApiSession("resumes.edit", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const result = await patchCandidate(
      db,
      id,
      actor,
      await readCandidateBody(request),
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return candidateErrorResponse(error);
  }
}
