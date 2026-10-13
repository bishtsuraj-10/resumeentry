import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResumeQueue } from "@/lib/queue";

export const maxDuration = 300;
const allowed = new Set([".pdf", ".docx", ".jpg", ".jpeg", ".png"]);
const batchSchema = z.coerce.number().int().min(1).max(5000);
const maxFileBytes = Number(process.env.MAX_FILE_SIZE ?? 20 * 1024 * 1024);
const requestFileLimit = 50;
const maxRequestBytes = Number(
  process.env.MAX_UPLOAD_BATCH_BYTES ?? 80 * 1024 * 1024,
);

function matchesFileSignature(extension: string, buffer: Buffer) {
  if (extension === ".pdf")
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg")
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".docx")
    return (
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    );
  return false;
}

export async function POST(request: Request) {
  const unauthorized = await requireApiSession("resumes.import", request);
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes + 2 * 1024 * 1024)
    return Response.json(
      { error: "Upload request exceeds the allowed size." },
      { status: 413 },
    );
  const form = await request.formData();
  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);
  const batchSize = batchSchema.safeParse(
    form.get("batchSize") ?? files.length,
  );
  if (
    !files.length ||
    !batchSize.success ||
    files.length > batchSize.data ||
    files.length > requestFileLimit
  )
    return Response.json(
      {
        error: `Choose up to ${Math.min(batchSize.data ?? requestFileLimit, requestFileLimit)} files per upload request.`,
      },
      { status: 400 },
    );
  if (files.reduce((sum, file) => sum + file.size, 0) > maxRequestBytes)
    return Response.json(
      { error: "Upload request exceeds the allowed size." },
      { status: 413 },
    );
  const batchName =
    String(form.get("batchName") ?? "Resume import")
      .trim()
      .slice(0, 120) || "Resume import";
  const batchId = String(form.get("batchId") ?? "").trim();
  const complete = form.get("complete") === "true";
  const storageRoot = path.resolve(
    /*turbopackIgnore: true*/ process.env.STORAGE_PATH ?? "./private-uploads",
  );
  await mkdir(storageRoot, { recursive: true });
  let batch = batchId
    ? await db.processingBatch.findUnique({ where: { id: batchId } })
    : null;
  if (batchId && !batch)
    return Response.json(
      { error: "Upload batch was not found." },
      { status: 404 },
    );
  if (!batch)
    batch = await db.processingBatch.create({
      data: { name: batchName, status: "UPLOADING" },
    });
  const accepted: string[] = [];
  const rejected: { file: string; reason: string }[] = [];
  let stored = 0;
  let exactDuplicates = 0;
  for (const file of files) {
    const safeName = path
      .basename(file.name)
      .replace(/[^\p{L}\p{N}._ -]/gu, "_")
      .slice(0, 180);
    const extension = path.extname(safeName).toLowerCase();
    if (
      !allowed.has(extension) ||
      file.size === 0 ||
      file.size > maxFileBytes
    ) {
      rejected.push({
        file: safeName,
        reason: "Unsupported format, empty file, or file exceeds size limit.",
      });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesFileSignature(extension, buffer)) {
      rejected.push({
        file: safeName,
        reason: "File contents do not match the selected file type.",
      });
      continue;
    }
    const hash = createHash("sha256").update(buffer).digest("hex");
    const existing = await db.resume.findFirst({
      where: { fileHash: hash },
      select: { id: true },
    });
    const targetPath = path.resolve(storageRoot, `${randomUUID()}${extension}`);
    if (!targetPath.startsWith(`${storageRoot}${path.sep}`)) {
      rejected.push({ file: safeName, reason: "Invalid file path." });
      continue;
    }
    await writeFile(targetPath, buffer, { flag: "wx", mode: 0o600 });
    try {
      const resume = await db.resume.create({
        data: {
          fileName: safeName,
          filePath: targetPath,
          fileType: extension.slice(1),
          fileSize: BigInt(file.size),
          fileHash: hash,
          batchId: batch.id,
          ...(existing
            ? {
                status: "DUPLICATE",
                duplicateOf: existing.id,
                processedAt: new Date(),
              }
            : {}),
        },
      });
      if (existing)
        await db.duplicate.create({
          data: {
            resumeId: resume.id,
            originalResumeId: existing.id,
            matchType: "FILE_HASH",
          },
        });
      else accepted.push(resume.id);
      stored += 1;
      if (existing) exactDuplicates += 1;
    } catch (error) {
      await unlink(targetPath).catch(() => undefined);
      if (error instanceof Error && error.message.includes("Unique constraint"))
        rejected.push({
          file: safeName,
          reason: "Exact duplicate file already exists.",
        });
      else throw error;
    }
  }
  const batchAfterUpload = await db.processingBatch.update({
    where: { id: batch.id },
    data: {
      totalFiles: { increment: stored },
      processedFiles: { increment: exactDuplicates },
      status: complete ? "PROCESSING" : "UPLOADING",
    },
  });
  if (
    complete &&
    batchAfterUpload.processedFiles >= batchAfterUpload.totalFiles
  )
    await db.processingBatch.update({
      where: { id: batch.id },
      data: { status: "COMPLETED" },
    });
  await Promise.all(
    accepted.map((resumeId) =>
      getResumeQueue().add("process-resume", { resumeId }, { jobId: resumeId }),
    ),
  );
  await db.auditLog.create({
    data: {
      actor,
      action: "resume.batch_uploaded",
      targetId: batch.id,
      metadata: { accepted: accepted.length, rejected: rejected.length },
    },
  });
  return Response.json(
    {
      batchId: batch.id,
      accepted: stored,
      duplicates: exactDuplicates,
      rejected,
      queued: accepted.length,
    },
    { status: 202 },
  );
}
