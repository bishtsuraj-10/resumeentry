import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { recoverExpired } from "./processing";

export const processingJobId = (id: string, generation: number) =>
  `${id}-g${generation}`;

export async function scheduleResume(
  db: PrismaClient,
  queue: Queue,
  id: string,
) {
  const now = new Date();
  // This durable scheduling lease bounds concurrent schedulers and outage retries.
  const claimed = await db.resume.updateMany({
    where: {
      id,
      status: "PENDING",
      scheduleAfter: { lte: now },
      batch: { isNot: { status: "CANCELLED" } },
    },
    data: { scheduleAfter: new Date(now.getTime() + 60_000) },
  });
  if (!claimed.count) return "skipped" as const;
  const resume = await db.resume.findUniqueOrThrow({ where: { id } });
  try {
    // BullMQ waits indefinitely for initial Redis readiness. Fail fast before
    // starting commands; ioredis keeps reconnecting for the next recovery pass.
    const connection = queue.opts?.connection as
      | { status?: string }
      | undefined;
    if (connection?.status && connection.status !== "ready")
      return "deferred" as const;
    const jobId = processingJobId(id, resume.processingGeneration);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (!["completed", "failed", "unknown"].includes(state))
        return "queued" as const;
      await existing.remove();
    }
    await queue.add(
      "process-resume",
      { resumeId: id, generation: resume.processingGeneration },
      { jobId },
    );
    return "queued" as const;
  } catch {
    // PENDING is the durable outbox. Recovery retries after scheduling backoff.
    return "deferred" as const;
  }
}

export async function reconcileQueue(
  db: PrismaClient,
  queue: Queue,
  limit = 100,
) {
  await recoverExpired(db, limit);
  const pending = await db.resume.findMany({
    where: {
      status: "PENDING",
      scheduleAfter: { lte: new Date() },
      batch: { isNot: { status: "CANCELLED" } },
    },
    orderBy: [{ scheduleAfter: "asc" }, { id: "asc" }],
    select: { id: true },
    take: limit,
  });
  const summary = { queued: 0, skipped: 0, deferred: 0 };
  for (const { id } of pending) {
    const result = await scheduleResume(db, queue, id);
    summary[result]++;
    if (result === "deferred") break;
  }
  return summary;
}
