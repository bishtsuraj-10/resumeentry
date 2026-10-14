import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { candidateInclude } from "./candidate-data";
import { highestEducation } from "./resume-overview";

// The same authoritative relations as Resume Details; never parser evidence.
export const resumeExportInclude = {
  extraction: true,
  candidate: { include: candidateInclude },
} satisfies Prisma.ResumeInclude;
export type StoredExportResume = Prisma.ResumeGetPayload<{
  include: typeof resumeExportInclude;
}>;

export type ResumeExportRow = {
  id: string;
  fileName: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  status: string;
  overallConfidence: number;
  createdAt: string;
  [key: string]: string | number | null | undefined;
};

export const resumeExportColumns = [
  { header: "CV ID", key: "id", width: 24 },
  { header: "File Name", key: "fileName", width: 32 },
  { header: "Name", key: "name", width: 24 },
  { header: "Email", key: "email", width: 32 },
  { header: "Phone", key: "phone", width: 22 },
  { header: "Designation", key: "designation", width: 30 },
  { header: "Location", key: "Location", width: 30 },
  { header: "Headline", key: "Headline", width: 36 },
  { header: "Summary", key: "Summary", width: 60 },
  { header: "Total Experience (Months)", key: "Total Experience (Months)", width: 28 },
  { header: "Employment History", key: "Employment History", width: 60 },
  { header: "Highest Qualification", key: "Highest Qualification", width: 30 },
  { header: "Education", key: "Education", width: 55 },
  { header: "Skills", key: "Skills", width: 45 },
  { header: "Projects", key: "Projects", width: 60 },
  { header: "Certifications", key: "Certifications", width: 50 },
  { header: "Links", key: "Links", width: 45 },
  { header: "Additional Information", key: "Additional Information", width: 60 },
  { header: "Status", key: "status", width: 16 },
  { header: "Overall Confidence", key: "overallConfidence", width: 20 },
  { header: "Created At", key: "createdAt", width: 26 },
] as const;

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function ordered<T extends { position: number; id: string }>(records: T[]) {
  return [...records].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}
// Sort object keys recursively, retaining array order and explicit null/zero/false.
function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b))
      .map(([key, item]) => [key, stableJson(item)]));
  }
  return value;
}
function text(value: unknown): string | null {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object"
    ? JSON.stringify(stableJson(value), null, 2)
    : String(value);
}
function dateText(record: Record<string, unknown>, prefix: string) {
  const year = record[prefix + "Year"], month = record[prefix + "Month"], day = record[prefix + "Day"];
  const original = text(record[prefix + "Text"]);
  if (year == null) return original;
  const numeric = String(year) + (month == null ? "" : `-${String(month).padStart(2, "0")}`)
    + (day == null ? "" : `-${String(day).padStart(2, "0")}`);
  return original && original !== numeric ? `${numeric} (original: ${original})` : numeric;
}
type Attributes = [string, unknown][];
function entries(records: Attributes[]): string | null {
  if (!records.length) return null;
  return records.map((attributes, index) => {
    const parts = attributes.flatMap(([label, value]) => {
      const rendered = text(value);
      return rendered == null ? [] : [`${label}: ${rendered.replace(/\n/g, "\n    ")}`];
    });
    // Retain even an empty associated record instead of silently dropping it.
    return `${index + 1}. ${parts.join("\n   ")}`;
  }).join("\n\n");
}
function period(record: Record<string, unknown>): Attributes {
  return [["Start Date", dateText(record, "start")], ["End Date", dateText(record, "end")]];
}

export function mapStoredResume(row: StoredExportResume): ResumeExportRow {
  const e = row.extraction, p = row.candidate;
  const education = ordered(p?.education ?? []);
  return {
    id: row.id, fileName: row.fileName,
    name: e?.name ?? null, email: e?.email ?? null,
    phone: e?.phone ?? null, designation: e?.designation ?? null,
    Location: p?.locationText ?? null,
    Headline: p?.headline ?? null, Summary: p?.summary ?? null,
    "Total Experience (Months)": p?.totalExperienceMonths ?? null,
    "Employment History": entries(ordered(p?.employment ?? []).map((j) => [
      ["Employer", j.employer], ["Designation", j.designation], ...period(j),
      ["Current", j.isCurrent], ["Location", j.location], ["Employment Type", j.employmentType],
      ["Description", j.description], ["Responsibilities", j.responsibilities], ["Achievements", j.achievements],
    ])),
    "Highest Qualification": highestEducation(education)?.degree ?? null,
    Education: entries(education.map((j) => [
      ["Degree", j.degree], ["Institution", j.institution], ["Specialization", j.fieldOfStudy],
      ...period(j), ["Location", j.location], ["Grade", j.grade], ["Grade Scale", j.gradeScale], ["Description", j.description],
    ])),
    Skills: entries([...(p?.skills ?? [])].sort((a, b) => compareText(a.skillId, b.skillId)).map((s) => [
      ["Skill", s.skill.canonicalName], ["Category", s.skill.category],
      ["Terms", [...s.skill.terms].sort((a, b) => compareText(a.normalizedName, b.normalizedName)).map((t) => t.displayName)],
      ["Original Text", s.originalText], ["Context", s.context],
    ])),
    Projects: entries(ordered(p?.projects ?? []).map((j) => [
      ["Name", j.name], ["Description", j.description], ["Role", j.role], ...period(j), ["URL", j.url],
      ["Responsibilities", j.responsibilities], ["Achievements", j.achievements],
      ["Technologies", [...j.skills].sort((a, b) => compareText(a.skillId, b.skillId)).map((s) => ({ name: s.skill.canonicalName, category: s.skill.category }))],
    ])),
    Certifications: entries(ordered(p?.certifications ?? []).map((j) => [
      ["Name", j.name], ["Issuer", j.issuer], ["Credential ID", j.credentialId],
      ["Issue Date", dateText(j, "issue")], ["Expiry Date", dateText(j, "expiry")], ["URL", j.url],
    ])),
    Links: entries([...(p?.links ?? [])].sort((a, b) => compareText(a.id, b.id)).map((j) => [
      ["Type", j.type], ["URL", j.url], ["Label", j.label],
    ])),
    "Additional Information": entries(ordered(p?.additional ?? []).map((j) => [
      ["Type", j.type], ["Title", j.title], ["Details", j.details],
    ])),
    status: row.status,
    // Retain the existing rounded percentage, including zero for absent extraction.
    overallConfidence: Math.round((e?.overallConfidence ?? 0) * 100),
    createdAt: row.createdAt.toISOString(),
  };
}

export function createResumeWorksheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter) {
  const sheet = workbook.addWorksheet("Resumes", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = resumeExportColumns.map((column) => ({
    ...column, style: { alignment: { vertical: "top", wrapText: true } },
  }));
  sheet.getColumn("overallConfidence").numFmt = '0"%"';
  sheet.autoFilter = "A1:U1";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FF6652CF" },
  };
  return sheet;
}

export function appendResumeExportRow(sheet: Pick<ExcelJS.Worksheet, "addRow">, row: ResumeExportRow) {
  // Exactly one approved cell per column. Never serialize formula/hyperlink objects.
  const values = resumeExportColumns.map(({ header, key }) => {
    const value = row[key] ?? null;
    if (typeof value === "string" && value.length > 32767) {
      throw new Error(`Excel cell limit exceeded for "${header}" (${value.length} characters; maximum 32767). Download aborted to avoid data loss.`);
    }
    return value;
  });
  sheet.addRow(values).commit();
}

export function appendStoredResume(sheet: Pick<ExcelJS.Worksheet, "addRow">, row: StoredExportResume) {
  appendResumeExportRow(sheet, mapStoredResume(row));
}
