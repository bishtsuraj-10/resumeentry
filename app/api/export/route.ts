import ExcelJS from "exceljs";
import { PassThrough, Readable } from "node:stream";
import { requireApiSession, session } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  appendStoredResume,
  createResumeWorksheet,
  resumeExportInclude,
} from "@/lib/excel-export";

export const maxDuration = 300;
export async function GET(request: Request) {
  const unauthorized = await requireApiSession("resumes.export");
  if (unauthorized) return unauthorized;
  const actor = (await session())?.id;
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const status = new URL(request.url).searchParams.get("status");
  const allowed = [
    "COMPLETED",
    "REVIEW",
    "FAILED",
    "DUPLICATE",
    "CANCELLED",
    "REVIEWED",
  ];
  if (status && status !== "ALL" && !allowed.includes(status))
    return Response.json(
      { error: "Unsupported export status." },
      { status: 400 },
    );
  const where =
    status === "REVIEWED"
      ? { extraction: { is: { reviewedAt: { not: null } } } }
      : status && status !== "ALL"
        ? {
            status: status as
              | "COMPLETED"
              | "REVIEW"
              | "FAILED"
              | "DUPLICATE"
              | "CANCELLED",
          }
        : {};
  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });
  const sheet = createResumeWorksheet(workbook);
  void (async () => {
    try {
      let cursor: string | undefined;
      while (true) {
        const rows = await db.resume.findMany({
          where,
          include: resumeExportInclude,
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (!rows.length) break;
        for (const row of rows) {
          appendStoredResume(sheet, row);
        }
        cursor = rows[rows.length - 1].id;
        if (rows.length < 500) break;
      }
      await sheet.commit();
      await workbook.commit();
      await db.auditLog.create({
        data: {
          actor,
          action: "export.completed",
          metadata: { status: status ?? "ALL" },
        },
      });
    } catch (error) {
      output.destroy(
        error instanceof Error ? error : new Error("Excel export failed"),
      );
    }
  })();
  return new Response(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="resume-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
