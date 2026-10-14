import "dotenv/config";
import { db } from "../lib/db";
import {
  reconcileBatch,
  terminalStatuses,
  transaction,
} from "../lib/processing";

// Historical repair is opt-in. Default mode only reports aggregate discrepancies.
const apply = process.argv.includes("--apply");
const batchId = process.argv
  .find((arg) => arg.startsWith("--batch="))
  ?.slice(8);
let cursor: string | undefined;
let inspected = 0;
let inconsistent = 0;
async function main() {
if (process.argv.some((arg) => arg.startsWith("--batch=")) && !batchId) throw new Error("Empty batch selector");
try {
  while (true) {
    const batches = await db.processingBatch.findMany({
      where: {
        ...(batchId ? { id: batchId } : cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!batches.length) break;
    for (const batch of batches) {
      inspected++;
      const total = await db.resume.count({ where: { batchId: batch.id } });
      const processed = await db.resume.count({
        where: { batchId: batch.id, status: { in: terminalStatuses } },
      });
      if (
        total !== batch.totalFiles ||
        processed !== batch.processedFiles ||
        (!["UPLOADING", "CANCELLED"].includes(batch.status) &&
          (processed === total) !== (batch.status === "COMPLETED"))
      ) {
        inconsistent++;
        if (apply) await transaction(db, async (tx) => {
          await reconcileBatch(tx, batch.id);
          await tx.auditLog.create({ data: { actor: "system:batch-reconciliation", action: "batch.reconciled", targetId: batch.id } });
        });
      }
    }
    if (batchId || batches.length < 100) break;
    cursor = batches[batches.length - 1].id;
  }
  console.info(
    JSON.stringify({
      mode: apply ? "apply" : "preview",
      inspected,
      inconsistent,
    }),
  );
} finally {
  await db.$disconnect();
}
}
void main().catch(() => {
  console.error("Batch reconciliation failed; earlier batches may have been repaired.");
  process.exitCode = 1;
});
