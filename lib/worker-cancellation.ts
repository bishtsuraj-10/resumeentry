import type { Worker } from "bullmq";

// In 6.3.11 these IDs come from the lock-extension script's per-token failures.
// Transport exceptions emit `error` instead and do not prove job ownership loss.
export function connectQueueCancellation(worker: Pick<Worker, "on" | "cancelJob">) {
  worker.on("lockRenewalFailed", ids => {
    for (const id of ids) worker.cancelJob(id, "QUEUE_OWNERSHIP_LOST");
  });
  worker.on("stalled", id => { worker.cancelJob(id, "QUEUE_OWNERSHIP_LOST"); });
}
