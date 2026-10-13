import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession("batches.manage", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await getResumeQueue().resume();
  let cursor: string | undefined;
  let enqueued = 0;
  while (true) {
    const pending = await db.resume.findMany({
      where: { status: "PENDING", ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (!pending.length) break;
    await Promise.all(
      pending.map((resume) =>
        getResumeQueue().add(
          "process-resume",
          { resumeId: resume.id },
          { jobId: resume.id },
        ),
      ),
    );
    enqueued += pending.length;
    cursor = pending[pending.length - 1].id;
    if (pending.length < 1000) break;
  }
  await db.auditLog.create({
    data: { actor, action: "processing.started", metadata: { enqueued } },
  });
  return Response.json({ enqueued });
}
