import "dotenv/config";
import { Worker, UnrecoverableError } from "bullmq";
import IORedis from "ioredis";
import { db } from "../../../lib/db";
import { getResumeQueue } from "../../../lib/queue-client";
import { reconcileQueue } from "../../../lib/processing-queue";
import { runResumeJob } from "../../../lib/resume-worker";

const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
const configured = Number(process.env.WORKER_CONCURRENCY ?? 5);
const concurrency = Number.isFinite(configured)
  ? Math.max(1, Math.floor(configured))
  : 5;
const queue = getResumeQueue();
const worker = new Worker(
  "resume-processing",
  async (job) => {
    const outcome = await runResumeJob(db, job.data);
    if (outcome === "permanent")
      throw new UnrecoverableError("Document validation or decoding failed.");
    if (outcome === "retry")
      throw new Error("Resume processing failed; retry scheduled.");
  },
  { connection, concurrency },
);

connection.on("error", () =>
  console.error(JSON.stringify({ event: "redis_connection_error" })),
);
worker.on("error", () =>
  console.error(JSON.stringify({ event: "worker_error" })),
);
let recovering = false;
let stopping = false;
async function recover() {
  if (recovering || stopping) return;
  recovering = true;
  try {
    const summary = await reconcileQueue(db, queue);
    if (summary.queued || summary.deferred)
      console.info(
        JSON.stringify({ event: "queue_reconciliation", ...summary }),
      );
  } catch {
    console.error(JSON.stringify({ event: "queue_reconciliation_failed" }));
  } finally {
    recovering = false;
  }
}
void recover();
const recoveryTimer = setInterval(() => void recover(), 15_000);
console.info(JSON.stringify({ event: "worker_started", concurrency }));
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(recoveryTimer);
  await worker.close();
  while (recovering) await new Promise((resolve) => setTimeout(resolve, 50));
  await queue.close();
  await connection.quit();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
