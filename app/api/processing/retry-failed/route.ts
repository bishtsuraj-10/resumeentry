import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";
import { retryResume } from "@/lib/processing";
import { scheduleResume } from "@/lib/processing-queue";
export async function POST(request: Request) {
  const unauthorized = await requireApiSession("resumes.retry_all", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let cursor: string | undefined;
  let retried = 0;
  let skipped = 0;
  let deferred = 0;
  let failed = 0;
  let queueUnavailable = false;
  while (true) {
    const resumes = await db.resume.findMany({
      where: { status: "FAILED", ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, batchId: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!resumes.length) break;
    for (const { id } of resumes) {
      try {
        const retry = await retryResume(db, id, actor);
        if (!retry) {
          skipped++;
          continue;
        }
        if (queueUnavailable) {
          deferred++;
          continue;
        }
        const result = await scheduleResume(db, getResumeQueue(), id);
        if (result === "queued") retried++;
        else if (result === "deferred") {
          deferred++;
          queueUnavailable = true;
        } else skipped++;
      } catch {
        failed++;
      }
    }
    cursor = resumes[resumes.length - 1].id;
    if (resumes.length < 500) break;
  }
  await db.auditLog.create({
    data: {
      actor,
      action: "processing.failed_retried",
      metadata: { retried, skipped, deferred, failed },
    },
  });
  return Response.json({ retried, skipped, deferred, failed });
}
