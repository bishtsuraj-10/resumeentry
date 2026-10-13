import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";

export async function POST(
  request: Request,
  context: RouteContext<"/api/batches/[id]/cancel">,
) {
  const unauthorized = await requireApiSession("batches.manage", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const batch = await db.processingBatch.findUnique({ where: { id } });
  if (!batch)
    return Response.json({ error: "Batch not found." }, { status: 404 });
  if (["COMPLETED", "CANCELLED"].includes(batch.status))
    return Response.json(
      { error: `Batch is already ${batch.status.toLowerCase()}.` },
      { status: 409 },
    );
  const pending = await db.resume.findMany({
    where: { batchId: id, status: "PENDING" },
    select: { id: true },
  });
  const queue = getResumeQueue();
  await Promise.all(
    pending.map(async ({ id: resumeId }) => {
      const job = await queue.getJob(resumeId);
      if (!job) return;
      const state = await job.getState();
      if (["waiting", "delayed", "paused", "waiting-children"].includes(state))
        await job.remove();
    }),
  );
  const cancelled = await db.resume.updateMany({
    where: { batchId: id, status: "PENDING" },
    data: { status: "CANCELLED", processedAt: new Date() },
  });
  await db.processingBatch.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  await db.auditLog.create({
    data: {
      actor,
      action: "batch.cancelled",
      targetId: id,
      metadata: { cancelledResumes: cancelled.count },
    },
  });
  return Response.json({
    cancelled: cancelled.count,
    running: Math.max(
      0,
      batch.totalFiles - batch.processedFiles - cancelled.count,
    ),
  });
}
