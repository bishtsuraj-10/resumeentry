import { requireApiSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const unauthorized = await requireApiSession("dashboard.view");
  if (unauthorized) return unauthorized;
  const cutoff = new Date(Date.now() - 60_000);
  const [total, grouped, review, duplicates, latestBatch, processedLastMinute] =
    await Promise.all([
      db.resume.count(),
      db.resume.groupBy({ by: ["status"], _count: { _all: true } }),
      db.resume.count({ where: { status: "REVIEW" } }),
      db.resume.count({ where: { status: "DUPLICATE" } }),
      db.processingBatch.findFirst({
        where: { status: { in: ["PROCESSING", "QUEUED"] } },
        orderBy: { updatedAt: "desc" },
      }),
      db.resume.count({
        where: {
          status: { in: ["COMPLETED", "REVIEW", "FAILED", "DUPLICATE"] },
          processedAt: { gte: cutoff },
        },
      }),
    ]);
  const counts = Object.fromEntries(
    grouped.map(({ status, _count }) => [status, _count._all]),
  );
  const processed =
    (counts.COMPLETED ?? 0) +
    (counts.REVIEW ?? 0) +
    (counts.FAILED ?? 0) +
    (counts.DUPLICATE ?? 0) +
    (counts.CANCELLED ?? 0);
  const speedPerMinute = processedLastMinute;
  const remaining = (counts.PENDING ?? 0) + (counts.PROCESSING ?? 0);
  return Response.json({
    total,
    processed,
    pending: counts.PENDING ?? 0,
    processing: counts.PROCESSING ?? 0,
    remaining,
    successful: counts.COMPLETED ?? 0,
    review,
    failed: counts.FAILED ?? 0,
    duplicates,
    cancelled: counts.CANCELLED ?? 0,
    speedPerMinute,
    etaSeconds: speedPerMinute
      ? Math.ceil((remaining / speedPerMinute) * 60)
      : null,
    percentage: total ? Math.round((processed / total) * 1000) / 10 : 0,
    latestBatch,
  });
}
