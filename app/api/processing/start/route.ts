import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue, resumeQueueReady } from "@/lib/queue";

import { scheduleResume } from "@/lib/processing-queue";
import { recoverExpired } from "@/lib/processing";
export async function POST(request: Request) {
  const unauthorized = await requireApiSession("batches.manage", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const queue = getResumeQueue();
  if (!resumeQueueReady(queue)) return Response.json({ error: "Queue unavailable. Pending work remains recoverable." }, { status: 503 });
  await queue.resume();
  await recoverExpired(db);
  let deferred = 0;
  let queueUnavailable = false;
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
    for (const resume of pending) {
      if (queueUnavailable) { deferred++; continue; }
      const result = await scheduleResume(db, getResumeQueue(), resume.id);
      if (result === "queued") enqueued++;
      if (result === "deferred") { deferred++; queueUnavailable = true; }
    }
    cursor = pending[pending.length - 1].id;
    if (pending.length < 1000) break;
  }
  await db.auditLog.create({
    data: { actor, action: "processing.started", metadata: { enqueued } },
  });
  return Response.json({ enqueued, deferred });
}
