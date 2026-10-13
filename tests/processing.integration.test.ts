import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runResumeJob } from "../lib/resume-worker";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  cancelBatch,
  claimResume,
  failResume,
  finalizeResume,
  PermanentProcessingError,
  reconcileBatch,
  recoverExpired,
  renewClaim,
  retryResume,
  saveReview,
  transaction,
} from "../lib/processing";
import { reconcileQueue, scheduleResume } from "../lib/processing-queue";
import { extractResumeFields } from "../lib/resume-parser";
import type { Queue } from "bullmq";
import { Queue as RedisQueue } from "bullmq";
import IORedis from "ioredis";

// Explicit opt-in only. A random, isolated schema is created on this database.
const url = process.env.M1_TEST_DATABASE_URL;
const schema = "m1_test_" + randomUUID().replaceAll("-", "");
let db: PrismaClient;
let admin: PrismaClient;
let fixtureDir: string;
const extraction = (email = randomUUID() + "@example.com") =>
  extractResumeFields("Alex Smith\nSoftware Engineer\n" + email);
const review = {
  name: "Human Name",
  email: "human@example.com",
  phone: null,
  normalizedPhone: null,
  countryCode: null,
  designation: "Human Title",
};

describe.skipIf(!url)(
  "PostgreSQL processing reliability (isolated schema)",
  () => {
    beforeAll(async () => {
      fixtureDir = await mkdtemp(path.join(tmpdir(), "m1-fixtures-"));
      admin = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      // Adapter schema qualifies Prisma SQL; options sets search_path for raw migrations.
      db = new PrismaClient({
        adapter: new PrismaPg(
          { connectionString: url, options: `-c search_path=${schema}` },
          { schema },
        ),
      });
      const { Client } = createRequire(import.meta.url)("pg");
      const client = new Client({
        connectionString: url,
        options: `-c search_path=${schema}`,
      });
      await client.connect();
      try {
        for (const dir of (await readdir("prisma/migrations")).sort()) {
          if (dir === "migration_lock.toml") continue;
          if (dir === "20261013010000_processing_reliability")
            await client.query(
              `INSERT INTO "Resume" ("id","fileName","filePath","fileType","fileSize","fileHash","status","updatedAt") VALUES ('legacy','legacy.pdf','legacy','pdf',1,'legacy','COMPLETED',CURRENT_TIMESTAMP)`,
            );
          const sql = await readFile(
            `prisma/migrations/${dir}/migration.sql`,
            "utf8",
          );
          await client.query(
            sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ""),
          );
        }
      } finally {
        await client.end();
      }
    }, 30_000);
    afterAll(async () => {
      await db?.$disconnect();
      // Only the exact schema generated above can be removed.
      if (admin && /^m1_test_[a-f0-9]{32}$/.test(schema))
        await admin.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
        );
      await admin?.$disconnect();
      if (fixtureDir) await rm(fixtureDir, { recursive: true });
    });

    async function make(
      status: "PENDING" | "FAILED" | "DUPLICATE" = "PENDING",
      batchId?: string,
    ) {
      return db.resume.create({
        data: {
          fileName: "synthetic.pdf",
          filePath: randomUUID(),
          fileType: "pdf",
          fileSize: BigInt(1),
          fileHash: randomUUID(),
          status,
          batchId,
        },
      });
    }
    async function batch() {
      return db.processingBatch.create({
        data: { name: "M1 isolated test", status: "PROCESSING" },
      });
    }
    async function claim(id: string) {
      const result = await claimResume(db, id, 0);
      expect(result?.claimToken).toBeTruthy();
      return result!;
    }
    async function expire(id: string) {
      await db.resume.update({
        where: { id },
        data: { leaseUntil: new Date(0) },
      });
    }
    function fakeQueue(outage = false) {
      const jobs = new Map<
        string,
        {
          state: string;
          getState: () => Promise<string>;
          remove: () => Promise<void>;
        }
      >();
      let added = 0;
      const queue = {
        getJob: async (id: string) => {
          if (outage) throw new Error("Redis unavailable");
          return jobs.get(id);
        },
        add: async (_name: string, _data: unknown, opts: { jobId: string }) => {
          if (outage) throw new Error("Redis unavailable");
          if (!jobs.has(opts.jobId)) {
            added++;
            const job = {
              state: "waiting",
              getState: async () => job.state,
              remove: async () => {
                jobs.delete(opts.jobId);
              },
            };
            jobs.set(opts.jobId, job);
          }
        },
      } as unknown as Queue;
      return {
        queue,
        jobs,
        get added() {
          return added;
        },
      };
    }

    it("applies additive migrations and preserves existing schema", async () => {
      expect(
        await db.resume.findUnique({ where: { id: "legacy" } }),
      ).toMatchObject({
        status: "COMPLETED",
        fileHash: "legacy",
        processingGeneration: 0,
      });
      const r = await make();
      expect(r.processingAttempts).toBe(0);
      expect(r.processingGeneration).toBe(0);
    });
    it("allows only one simultaneous owner and skips duplicate delivery", async () => {
      const r = await make();
      const claims = await Promise.all([
        claimResume(db, r.id, 0),
        claimResume(db, r.id, 0),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await claimResume(db, r.id, 0)).toBeNull();
    });
    it("renews a live lease but cannot revive an expired claim", async () => {
      const r = await claim((await make()).id);
      expect(await renewClaim(db, r.id, r.claimToken!)).toBe(true);
      await expire(r.id);
      expect(await renewClaim(db, r.id, r.claimToken!)).toBe(false);
    });
    it("recovers expired claims and rejects stale finalization and stale errors", async () => {
      const r = await claim((await make()).id);
      await expire(r.id);
      await recoverExpired(db);
      const newer = await claim(r.id);
      expect(newer.claimToken).not.toBe(r.claimToken);
      expect(
        await finalizeResume(db, r.id, r.claimToken!, extraction(), false),
      ).toBe(false);
      expect(await failResume(db, r.id, r.claimToken!, new Error())).toBe(
        false,
      );
      expect(
        await finalizeResume(
          db,
          newer.id,
          newer.claimToken!,
          extraction(),
          false,
        ),
      ).toBe(true);
    });
    it("finalizes once, stores extraction and counts normal completion atomically", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id);
      expect(
        await finalizeResume(db, r.id, r.claimToken!, extraction(), false),
      ).toBe(true);
      expect(
        await finalizeResume(db, r.id, r.claimToken!, extraction(), false),
      ).toBe(false);
      expect(await claimResume(db, r.id, 0)).toBeNull();
      expect(
        await db.resumeExtraction.count({ where: { resumeId: r.id } }),
      ).toBe(1);
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({
        totalFiles: 1,
        processedFiles: 1,
        status: "COMPLETED",
      });
    });
    it("counts REVIEW as processed", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id);
      await finalizeResume(db, r.id, r.claimToken!, extraction(), true);
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "REVIEW" },
      );
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({ processedFiles: 1 });
    });
    it("serializes candidate duplicate detection across concurrent finalizations", async () => {
      const b = await batch(),
        r1 = await claim((await make("PENDING", b.id)).id),
        r2 = await claim((await make("PENDING", b.id)).id);
      const fields = extraction();
      await Promise.all([
        finalizeResume(db, r1.id, r1.claimToken!, fields, false),
        finalizeResume(db, r2.id, r2.claimToken!, fields, false),
      ]);
      const rows = await db.resume.findMany({ where: { batchId: b.id } });
      expect(rows.map((r) => r.status).sort()).toEqual([
        "COMPLETED",
        "DUPLICATE",
      ]);
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({ totalFiles: 2, processedFiles: 2 });
    });
    it("counts exact-file duplicates and preserves UPLOADING", async () => {
      const b = await db.processingBatch.create({
        data: { name: "Upload test", status: "UPLOADING" },
      });
      await make("DUPLICATE", b.id);
      await transaction(db, (tx) => reconcileBatch(tx, b.id));
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({
        totalFiles: 1,
        processedFiles: 1,
        status: "UPLOADING",
      });
    });
    it("stops permanent errors immediately, retaining history", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id);
      await failResume(db, r.id, r.claimToken!, new PermanentProcessingError());
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "FAILED", processingAttempts: 1 },
      );
      expect(
        await db.extractionError.findFirst({ where: { resumeId: r.id } }),
      ).toMatchObject({
        errorType: "PERMANENT",
        errorMessage:
          "Document validation or decoding failed (INVALID_DOCUMENT).",
      });
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({ processedFiles: 1 });
    });
    it("bounds attempts including repeated crashes and idempotent recovery", async () => {
      const b = await batch(),
        r = await make("PENDING", b.id);
      for (let i = 0; i < 3; i++) {
        await claim(r.id);
        await expire(r.id);
        await recoverExpired(db);
        await recoverExpired(db);
      }
      expect(await claimResume(db, r.id, 0)).toBeNull();
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "FAILED", processingAttempts: 3 },
      );
      expect(
        await db.extractionError.count({ where: { resumeId: r.id } }),
      ).toBe(3);
    });
    it("bounds automatic transient retries", async () => {
      const r = await make();
      for (let i = 0; i < 3; i++) {
        const c = await claim(r.id);
        await failResume(db, r.id, c.claimToken!, new Error());
      }
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "FAILED" },
      );
    });
    it("claims individual/bulk retries once and never double-decrements progress", async () => {
      const b = await batch(),
        r = await make("FAILED", b.id);
      await transaction(db, (tx) => reconcileBatch(tx, b.id));
      const retries = await Promise.all(
        Array.from({ length: 4 }, () => retryResume(db, r.id, "test")),
      );
      expect(retries.filter(Boolean)).toHaveLength(1);
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({ totalFiles: 1, processedFiles: 0 });
      expect(await claimResume(db, r.id, 0)).toBeNull();
      expect(await claimResume(db, r.id, 1)).not.toBeNull();
    });
    it("preserves cancellation for pending, running and stale finalization", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id),
        pending = await make("PENDING", b.id);
      expect(await cancelBatch(db, b.id, "test")).toBe(2);
      expect(
        await finalizeResume(db, r.id, r.claimToken!, extraction(), false),
      ).toBe(false);
      expect(await claimResume(db, pending.id, 0)).toBeNull();
      expect(await saveReview(db, r.id, "test", review)).toBeNull();
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({
        processedFiles: 2,
        totalFiles: 2,
        status: "CANCELLED",
      });
    });
    it("protects a review saved during processing and retains verification timestamp", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id);
      const saved = await saveReview(db, r.id, "test", review);
      expect(saved?.reviewedAt).toBeTruthy();
      expect(saved?.nameConfidence).toBe(0);
      expect(
        await finalizeResume(db, r.id, r.claimToken!, extraction(), false),
      ).toBe(false);
      expect(
        await db.resumeExtraction.findUnique({ where: { resumeId: r.id } }),
      ).toMatchObject({ name: "Human Name", reviewedAt: saved!.reviewedAt });
    });
    it("preserves review precedence when review and finalization race", async () => {
      const r = await claim((await make()).id);
      await Promise.all([
        saveReview(db, r.id, "test", review),
        finalizeResume(db, r.id, r.claimToken!, extraction(), true),
      ]);
      expect(
        await db.resumeExtraction.findUnique({ where: { resumeId: r.id } }),
      ).toMatchObject({ name: "Human Name", requiresReview: false });
    });
    it("rolls back extraction and status on transactional failure", async () => {
      const b = await batch(),
        r = await claim((await make("PENDING", b.id)).id);
      await expect(
        finalizeResume(
          db,
          r.id,
          r.claimToken!,
          { ...extraction(), nameConfidence: "invalid" as unknown as number },
          false,
        ),
      ).rejects.toThrow();
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "PROCESSING", claimToken: r.claimToken },
      );
      expect(
        await db.resumeExtraction.count({ where: { resumeId: r.id } }),
      ).toBe(0);
    });
    it("recovers orphaned pending work and bounds concurrent/repeated schedulers", async () => {
      const r = await make(),
        fake = fakeQueue();
      await Promise.all([
        scheduleResume(db, fake.queue, r.id),
        scheduleResume(db, fake.queue, r.id),
      ]);
      expect(fake.added).toBe(1);
      await reconcileQueue(db, fake.queue);
      expect(fake.added).toBeGreaterThanOrEqual(1);
      expect(
        [...fake.jobs.keys()].filter((id) => id.startsWith(r.id)),
      ).toHaveLength(1);
    });
    it("keeps queue outages durable and schedules after recovery backoff", async () => {
      const b = await batch(),
        r = await make("FAILED", b.id);
      await retryResume(db, r.id, "test");
      expect(await scheduleResume(db, fakeQueue(true).queue, r.id)).toBe(
        "deferred",
      );
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "PENDING", processingGeneration: 1 },
      );
      await db.resume.update({
        where: { id: r.id },
        data: { scheduleAfter: new Date(0) },
      });
      const fake = fakeQueue();
      await Promise.all([
        reconcileQueue(db, fake.queue),
        reconcileQueue(db, fake.queue),
      ]);
      expect([...fake.jobs.keys()].filter((id) => id.startsWith(r.id))).toEqual(
        [r.id + "-g1"],
      );
    });
    async function fileResume(fixture: string, hashMismatch = false) {
      // Each actual parser test uses a distinct private fixture copy.
      const filePath = path.join(
        fixtureDir,
        randomUUID() + path.extname(fixture),
      );
      await copyFile(path.join("tests/fixtures", fixture), filePath);
      const fileHash = hashMismatch
        ? "wrong"
        : createHash("sha256")
            .update(await readFile(filePath))
            .digest("hex");
      return db.resume.create({
        data: {
          fileName: fixture,
          filePath,
          fileType: path.extname(fixture).slice(1),
          fileSize: BigInt(1),
          fileHash,
        },
      });
    }
    it("serializes candidate duplicate detection between different batches", async () => {
      const b1 = await batch(),
        b2 = await batch();
      const r1 = await claim((await make("PENDING", b1.id)).id),
        r2 = await claim((await make("PENDING", b2.id)).id);
      const fields = extraction();
      await Promise.all([
        finalizeResume(db, r1.id, r1.claimToken!, fields, false),
        finalizeResume(db, r2.id, r2.claimToken!, fields, false),
      ]);
      expect(
        (await db.resume.findMany({ where: { id: { in: [r1.id, r2.id] } } }))
          .map((r) => r.status)
          .sort(),
      ).toEqual(["COMPLETED", "DUPLICATE"]);
    });
    it("counts completions at configured default concurrency without exceeding totals", async () => {
      const b = await batch();
      const rows = [];
      for (let i = 0; i < 5; i++)
        rows.push(await claim((await make("PENDING", b.id)).id));
      await Promise.all(
        rows.map((r) =>
          finalizeResume(db, r.id, r.claimToken!, extraction(), false),
        ),
      );
      expect(
        await db.processingBatch.findUnique({ where: { id: b.id } }),
      ).toMatchObject({
        totalFiles: 5,
        processedFiles: 5,
        status: "COMPLETED",
      });
    });
    it("runs real PDF extraction once through duplicate worker deliveries", async () => {
      const r = await fileResume("sample-resume.pdf");
      const results = await Promise.all([
        runResumeJob(db, { resumeId: r.id }),
        runResumeJob(db, { resumeId: r.id }),
      ]);
      expect(results.sort()).toEqual(["completed", "skipped"]);
      expect(
        await db.resumeExtraction.findUnique({ where: { resumeId: r.id } }),
      ).toMatchObject({ email: "jordan.casey@example.com" });
    });
    it("fails a hash mismatch permanently through the actual worker", async () => {
      const r = await fileResume("sample-resume.pdf", true);
      expect(await runResumeJob(db, { resumeId: r.id })).toBe("permanent");
      expect(await db.resume.findUnique({ where: { id: r.id } })).toMatchObject(
        { status: "FAILED", processingAttempts: 1 },
      );
    });
    it("classifies corrupt PDF decoding permanently through the actual worker", async () => {
      const r = await fileResume("corrupt.pdf");
      expect(await runResumeJob(db, { resumeId: r.id })).toBe("permanent");
    });
    it("does not replace verified confidence with synthetic certainty", async () => {
      const r = await claim((await make()).id);
      await finalizeResume(db, r.id, r.claimToken!, extraction(), true);
      const original = await db.resumeExtraction.findUniqueOrThrow({
        where: { resumeId: r.id },
      });
      const saved = await saveReview(db, r.id, "test", review);
      expect(saved?.nameConfidence).toBe(original.nameConfidence);
      expect(saved?.overallConfidence).toBe(original.overallConfidence);
    });
    it("does not schedule terminal or cancelled work during recovery", async () => {
      const b = await batch(),
        r = await make("PENDING", b.id);
      await cancelBatch(db, b.id, "test");
      expect(await scheduleResume(db, fakeQueue().queue, r.id)).toBe("skipped");
      expect(await retryResume(db, r.id, "test")).toBeNull();
    });
    it("defers real BullMQ scheduling while Redis is initially unavailable", async () => {
      const r = await make();
      const connection = new IORedis("redis://127.0.0.1:55440", {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      connection.on("error", () => {});
      const queue = new RedisQueue("m1-unavailable-" + randomUUID(), {
        connection,
        skipWaitingForReady: true,
        skipVersionCheck: true,
      });
      queue.on("error", () => {});
      try {
        expect(await scheduleResume(db, queue, r.id)).toBe("deferred");
        expect(
          await db.resume.findUnique({ where: { id: r.id } }),
        ).toMatchObject({ status: "PENDING" });
      } finally {
        connection.disconnect();
        await queue.close().catch(() => {});
      }
    }, 2000);
    it("replaces a completed queue job when database work still needs processing", async () => {
      const r = await make(),
        fake = fakeQueue();
      await scheduleResume(db, fake.queue, r.id);
      fake.jobs.get(r.id + "-g0")!.state = "completed";
      await db.resume.update({
        where: { id: r.id },
        data: { scheduleAfter: new Date(0) },
      });
      await scheduleResume(db, fake.queue, r.id);
      expect(fake.added).toBe(2);
    });
  },
);
