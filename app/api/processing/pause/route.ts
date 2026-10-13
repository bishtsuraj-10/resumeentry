import { db } from "@/lib/db";
import { requireApiSession, session } from "@/lib/auth";
import { getResumeQueue } from "@/lib/queue";
export async function POST(request: Request) {
  const unauthorized = await requireApiSession("batches.manage", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await getResumeQueue().pause();
  await db.auditLog.create({ data: { actor, action: "processing.paused" } });
  return Response.json({ paused: true });
}
