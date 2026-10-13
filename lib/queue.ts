import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";

let queue: Queue | undefined;
export function getResumeQueue() {
  if (!queue) {
    const connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: null, enableReadyCheck: true },
    );
    queue = new Queue("resume-processing", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: false,
      },
    });
  }
  return queue;
}
