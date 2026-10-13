import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";
export async function POST(request: Request) {
  const unauthorized = await requireApiSession("resumes.retry_all", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let cursor: string | undefined;
  let retried = 0;
  while (true) {
    const resumes = await db.resume.findMany({
      where: { status: "FAILED", ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, batchId: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!resumes.length) break;
    await Promise.all(
      resumes.map(async ({ id, batchId }) => {
        if (batchId)
          await db.$transaction([
            db.resume.update({
              where: { id },
              data: { status: "PENDING", processedAt: null },
            }),
            db.processingBatch.update({
              where: { id: batchId },
              data: { processedFiles: { decrement: 1 }, status: "PROCESSING" },
            }),
          ]);
        else
          await db.resume.update({
            where: { id },
            data: { status: "PENDING", processedAt: null },
          });
        await getResumeQueue().add(
          "process-resume",
          { resumeId: id },
          { jobId: `${id}-retry-${Date.now()}`, attempts: 3 },
        );
      }),
    );
    retried += resumes.length;
    cursor = resumes[resumes.length - 1].id;
    if (resumes.length < 500) break;
  }
  await db.auditLog.create({
    data: { actor, action: "processing.failed_retried", metadata: { retried } },
  });
  return Response.json({ retried });
}
