import { db } from "@/lib/db";
import { requireApiSession, session } from "@/lib/auth";
import { getResumeQueue, resumeQueueReady } from "@/lib/queue";
export async function POST(request: Request) {
  const unauthorized = await requireApiSession("batches.manage", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const queue = getResumeQueue();
  if (!resumeQueueReady(queue))
    return Response.json({ error: "Queue unavailable." }, { status: 503 });
  await queue.resume();
  await db.auditLog.create({ data: { actor, action: "processing.resumed" } });
  return Response.json({ paused: false });
}
