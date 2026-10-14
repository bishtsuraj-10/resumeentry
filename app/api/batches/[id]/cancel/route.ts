import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelBatch } from "@/lib/processing";

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
  const cancelled = await cancelBatch(db, id, actor);
  if (cancelled === null)
    return Response.json(
      { error: "Batch is already terminal." },
      { status: 409 },
    );
  // Remaining jobs are harmless: their database claims are now ineligible.
  return Response.json({ cancelled, running: 0 });
}
