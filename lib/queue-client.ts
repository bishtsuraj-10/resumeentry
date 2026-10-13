import { Queue } from "bullmq";
import IORedis from "ioredis";

let queue: Queue | undefined;
export function resumeQueueReady(queue: Queue) {
  const connection = queue.opts.connection as { status?: string };
  return connection.status === "ready";
}
export function getResumeQueue() {
  if (!queue) {
    const connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        commandTimeout: 5000,
      },
    );
    queue = new Queue("resume-processing", {
      connection,
      // Producer commands use readiness checks and bounded command timeouts.
      // Avoid a failed startup INFO check poisoning initialization permanently.
      // The Worker performs the Redis version check (deployment requires Redis 7).
      skipWaitingForReady: true,
      skipVersionCheck: true,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: false,
      },
    });
    connection.on("error", () =>
      console.error(JSON.stringify({ event: "queue_connection_error" })),
    );
    queue.on("error", () =>
      console.error(JSON.stringify({ event: "queue_error" })),
    );
  }
  return queue;
}
