import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";
import { retryResume } from "@/lib/processing";
import { scheduleResume } from "@/lib/processing-queue";
export async function POST(
  request: Request,
  context: RouteContext<"/api/resumes/[id]/retry">,
) {
  const unauthorized = await requireApiSession("resumes.retry", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const resume = await db.resume.findUnique({ where: { id } });
  if (!resume)
    return Response.json({ error: "Resume not found." }, { status: 404 });
  if (resume.status !== "FAILED")
    return Response.json(
      { error: "Only failed resumes can be retried." },
      { status: 409 },
    );
  const retried = await retryResume(db, id, actor);
  if (!retried)
    return Response.json(
      { error: "Resume is no longer eligible for retry." },
      { status: 409 },
    );
  const scheduling = await scheduleResume(db, getResumeQueue(), id);
  return Response.json(
    {
      queued: scheduling === "queued",
      deferred: scheduling === "deferred",
      accepted: true,
    },
    { status: 202 },
  );
}
