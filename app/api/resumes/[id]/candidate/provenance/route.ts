import { requireApiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readCandidateProvenance, readRunEvidence } from "@/lib/candidate-data";
import { candidateErrorResponse } from "@/lib/candidate-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // Evidence may contain private excerpts; ordinary view permission is insufficient.
  const unauthorized = await requireApiSession("resumes.edit", request);
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const value = new URL(request.url).searchParams.get("page") ?? "1";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100000)
    return Response.json(
      { error: "Invalid provenance page." },
      { status: 400 },
    );
  try {
    if (!(await db.resume.findUnique({ where: { id }, select: { id: true } })))
      return Response.json({ error: "Resume not found." }, { status: 404 });
    const runId = new URL(request.url).searchParams.get("runId");
    if (runId !== null) {
      if (!runId.trim() || runId.length > 100)
        return Response.json(
          { error: "Invalid run identifier." },
          { status: 400 },
        );
      const run = await readRunEvidence(db, id, runId, Number(value));
      return run
        ? Response.json(
            { run, page: Number(value) },
            { headers: { "cache-control": "no-store" } },
          )
        : Response.json(
            { error: "Extraction run not found." },
            { status: 404 },
          );
    }
    return Response.json(
      {
        runs: await readCandidateProvenance(db, id, Number(value)),
        page: Number(value),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return candidateErrorResponse(error);
  }
}
