import { requireApiSession } from "@/lib/auth";
import { db } from "@/lib/db";
export async function GET(request: Request) {
  const unauthorized = await requireApiSession("batches.view");
  if (unauthorized) return unauthorized;
  const page = Math.max(
    1,
    Number(new URL(request.url).searchParams.get("page") ?? 1),
  );
  const [items, total] = await Promise.all([
    db.processingBatch.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 25,
      take: 25,
    }),
    db.processingBatch.count(),
  ]);
  return Response.json({ items, total, page, pages: Math.ceil(total / 25) });
}
