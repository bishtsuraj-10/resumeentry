# M1 worker reliability

M1 changes infrastructure only. Existing extraction, authentication, permissions,
audit logging, uploads, exports, and parser abstractions remain in place.

## Confirmed baseline problems

- Worker claims were unconditional; duplicate deliveries could both process and finalize.
- Only COMPLETED/DUPLICATE were skipped; running workers could overwrite cancellation or review.
- Extraction/status committed before batch increments, allowing incomplete or repeated progress.
- Candidate duplicate detection happened outside finalization and could race.
- Retry endpoints read FAILED before unconditional writes, used timestamp job IDs, and decremented counters independently.
- Upload metadata could commit before enqueue failed; no periodic database recovery existed.
- Batch cancellation only cancelled PENDING records and depended on Redis before database cancellation.
- Manual review wrote extraction, status and audit separately and assigned confidence 1 to confirmed fields.
- AI credentials alone enabled remote parsing.

## Ownership and lifecycle

PostgreSQL is the source of truth. PENDING rows are a durable outbox; Redis is
delivery infrastructure. Each explicit retry increments processingGeneration and
resets processingAttempts. Stable jobs use resume ID plus generation; legacy jobs
without generation are interpreted as generation zero.

Claiming conditionally changes eligible PENDING or expired PROCESSING rows to
PROCESSING, assigns a random claimToken, increments attempts and grants a
120-second lease. Database time controls leases, avoiding worker clock skew.
Renewal occurs every 40 seconds and at parsing boundaries. Expired tokens cannot
be renewed or finalize. Reviewed rows and cancelled batches are ineligible.

File hashing, parsing/OCR and optional AI run outside transactions. Short
Serializable transactions atomically guard ownership, store extraction, check
candidate identity, write duplicate relationships, finalize status and recount
batch progress. Serialization failures and deadlocks have bounded retries,
including Prisma driver-adapter commit conflict variants.

COMPLETED, REVIEW, DUPLICATE, FAILED and CANCELLED each contribute one processed
record. PENDING and PROCESSING contribute zero. Counts are derived from actual
batch members using existing batch/status indexes, rather than fragile increments.
UPLOADING remains UPLOADING until the upload explicitly closes; CANCELLED remains
CANCELLED regardless of counts. A cancelled batch can have full processed progress
without becoming COMPLETED.

Transient/unknown errors record a sanitized dependency category and return to
PENDING. BullMQ retains three attempts and exponential backoff starting at two
seconds. A durable three-claim budget per generation also bounds retries after
crashes, missing jobs, and queue recreation. Hash mismatch, unsupported formats,
empty extraction and recognized invalid/encrypted PDF errors stop immediately.
Unrecognized decoder exceptions receive bounded retries; their contents are not
logged. Error rows are retained across explicit retries.

Individual and bulk retries use the same atomic FAILED transition and reject
verified records or cancelled batches. HTTP 202 means retry accepted durably;
queued/deferred indicate immediate Redis outcome. Bulk summaries include retried,
skipped, deferred and failed; processing uses cursor pages and sequential bounded
scheduling. An outage stops further Redis calls in that bulk request.

Cancellation atomically revokes pending/running ownership and updates progress
and audit. Jobs can remain in Redis, but workers skip them. OCR already running may
finish consuming resources; it cannot write cancelled results.

Human review revokes worker ownership and commits extraction, terminal status,
progress and audit together. All submitted fields are protected by reviewedAt.
Existing machine confidence is retained; newly created human-only records default
to zero machine confidence. reviewedAt records verification separately.

## Recovery

The existing worker runs reconciliation at startup and every 15 seconds, with at
most one local pass active. Each pass examines at most 100 expired claims and 100
due PENDING rows. Scheduling is conditionally reserved in PostgreSQL for 60 seconds.
Multiple worker/application instances may run safely; no Redis table scan occurs.
Existing waiting/active/delayed/paused jobs are reused. Completed/failed jobs for
still-pending work are replaced under the scheduling reservation. Active jobs are
never forcibly removed.

Redis commands fail fast when the producer connection is not ready; connected
commands have five-second timeouts and bounded request retries. The connection
keeps reconnecting. A failed pass stops scheduling further rows and later passes
retry due work. Queue reconciliation never resumes a paused queue. Old PROCESSING
rows with no lease become recoverable after rollout.

The producer avoids startup readiness/INFO waits so an initial outage cannot
permanently poison BullMQ initialization. Redis version validation is retained
by the Worker; deployment continues to require Redis 7. The web queue module
retains its server-only guard while the worker imports the shared Node client.

This design guarantees fenced database writes, not exactly-once OCR execution.
Expired workers may finish computation concurrently with a replacement; only
the valid token can persist results. Recovery requires an operational worker.
For a large backlog, 100 due rows per 15-second pass bounds repair throughput.
Per-batch recounts and Serializable contention should be monitored under real
5,000-file workloads; bounded conflict exhaustion remains recoverable.

## Migration and rollout

Migration: 20261013010000_processing_reliability.

Additive Resume columns: claimToken (nullable text), leaseUntil (nullable timestamp),
processingGeneration (integer default 0), processingAttempts (integer default 0),
scheduleAfter (timestamp default current time). Indexes: status/scheduleAfter and
status/leaseUntil. Existing records and extraction/error histories are preserved.
Migration does not repair historical batch counts.

1. Back up the database and confirm persistent shared upload storage.
2. Stop all old worker instances before rollout; old code does not honor fencing.
3. Deploy schema with `npx prisma migrate deploy` and regenerate client with
   `npx prisma generate` using your established deployment process.
4. Deploy web and new workers together; start workers after migration completes.
5. Confirm recovery logs and batch counts, and leave AI_PARSING_ENABLED=false.

Compose's existing setup job now performs migrations after client generation,
before both web and worker start. No production migration was applied by this task.
Docker Compose startup ordering itself requires verification on a running Docker daemon.

## Historical reconciliation

Preview only:

```powershell
npx tsx scripts/reconcile-batches.ts
npx tsx scripts/reconcile-batches.ts --batch=YOUR_BATCH_ID
```

After inspecting preview and taking a backup, explicitly repair selected data:

```powershell
npx tsx scripts/reconcile-batches.ts --batch=YOUR_BATCH_ID --apply
```

Without --batch, --apply processes batches in pages of 100. Apply recounts inside
Serializable transactions, preserves UPLOADING/CANCELLED and writes an audit event
for each repaired batch. It does not alter resumes or extraction data.

## Tests

```powershell
# Ordinary suite skips PostgreSQL integration unless explicitly configured.
npx vitest run
# Use a dedicated development/test database with schema-creation permissions:
$env:M1_TEST_DATABASE_URL = "postgresql://test_user:password@localhost:5432/test_database"
npx vitest run
npx tsc --noEmit
npx prisma validate
npm run lint
npm run build
```

Integration tests create a unique m1*test* schema, apply existing migrations there,
insert a legacy row before M1 and verify preservation, then remove only that schema.
They never use DATABASE_URL implicitly. Queue-success/outage tests use a queue
double while ownership, retries, accounting, cancellation, review and concurrency
execute against real PostgreSQL. Real worker PDF parsing is also exercised.

The implementation run used a disposable local PostgreSQL 16 cluster on loopback
port 55439 because the configured application database was unreachable and Docker
was stopped. Prisma migrate deploy was separately tested on that disposable
cluster. No application seed or migration was run against the configured database.

Verification at implementation time: all 49 tests passed (11 original, 27
PostgreSQL integration, 5 policy and 6 retry HTTP tests); TypeScript, Prisma
validation, ESLint and production build passed. The initial sandbox blocked
Vitest/build subprocess creation; reruns with execution permission passed.
Prisma migration deployment and reconciliation CLI preview/apply were executed
against the disposable server. These results do not cover the staging checks below.
Compose configuration validation also passed, with existing environment-file
dollar interpolation warnings. Check literal dollar quoting in your deployment
environment before Docker rollout; the private environment file was left unchanged.

## Manual acceptance checks (development only)

1. Apply migration, generate client, start Redis, web and worker. Upload PDF/DOCX
   fixtures and an exact duplicate. Verify totals, extraction, terminal statuses
   and one processed contribution per record.
2. Upload a slow OCR document, terminate the worker while PROCESSING, restart it
   and allow lease expiry (up to 120 seconds) plus reconciliation. Verify eventual
   terminal state or bounded FAILED, LEASE_EXPIRED history, and no double count.
3. Stop Redis, upload a fresh file and retry a FAILED record. Expect durable
   acceptance with deferred work. Restart Redis, allow scheduling backoff (60
   seconds) and reconciliation, then verify processing. Repeat with the worker
   initially started while Redis is down.
4. Issue two individual retries and a bulk retry simultaneously for the same
   FAILED record. Verify only one generation increment, one progress reversal,
   preserved errors, and successful completion after recovery.
5. Cancel a batch during OCR. Confirm running/pending records stay CANCELLED,
   batch stays CANCELLED, and progress includes cancelled records.
6. Save human corrections while processing. Confirm reviewedAt persists,
   submitted values win and machine confidence is not replaced with 1.
7. Pause the queue, upload/recover work and verify recovery does not resume it.
   Resume explicitly and check progress.

Not yet verified: real Redis outage/reconnect and stalled-job behavior, authenticated
browser upload/review/export flows, image/OCR crash tests, Docker startup, and
large-batch performance. Unit or database tests alone do not establish production
reliability. Complete these acceptance checks in staging before calling M1 fully accepted.
