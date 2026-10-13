import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireApiSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/resumes/[id]/file">,
) {
  const unauthorized = await requireApiSession("resumes.download");
  if (unauthorized) return unauthorized;
  const { id } = await context.params;
  const resume = await db.resume.findUnique({
    where: { id },
    select: { filePath: true, fileName: true, fileType: true },
  });
  if (!resume)
    return Response.json({ error: "Resume not found." }, { status: 404 });
  const root = path.resolve(
    /*turbopackIgnore: true*/ process.env.STORAGE_PATH ?? "./private-uploads",
  );
  const filePath = path.resolve(resume.filePath);
  if (!filePath.startsWith(`${root}${path.sep}`))
    return Response.json(
      { error: "File is outside private storage." },
      { status: 403 },
    );
  try {
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "content-type":
          resume.fileType === "pdf"
            ? "application/pdf"
            : "application/octet-stream",
        "content-disposition": `${resume.fileType === "pdf" ? "inline" : "attachment"}; filename="${resume.fileName.replace(/[\r\n"\\]/g, "_")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Stored resume file is unavailable." },
      { status: 404 },
    );
  }
}
