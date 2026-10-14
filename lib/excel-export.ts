import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { candidateInclude } from "./candidate-data";
import { highestEducation } from "./resume-overview";

// Read the same authoritative relations as Resume Details, never parser evidence.
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
  nameConfidence: number;
  emailConfidence: number;
  phoneConfidence: number;
  designationConfidence: number;
  overallConfidence: number;
  status: string;
  createdAt: string;
  [key: string]: string | number | boolean | null | undefined;
};

const profileFields = ["firstName", "lastName", "additionalEmails", "additionalPhones", "city", "region", "country", "locationText", "dateOfBirth", "headline", "summary", "objective", "totalExperienceMonths", "noticePeriod", "employmentPreferences"] as const;
const profileHeaders = ["First Name", "Last Name", "Additional Emails", "Additional Phones", "City", "State / Region", "Country", "Location", "Date of Birth", "Headline", "Summary", "Objective", "Total Experience (Months)", "Notice Period", "Employment Preferences"];
const comparisonColumns = ["Other Emails", "Phone Country Code", "Normalized Phone", ...profileHeaders, "Highest Qualification", "Qualifications", "Skills", "Top Skills", "Employment History", "Employer", "Job Title / Role", "Employment Start Date", "Employment End Date", "Employment Description", "Education", "Degree", "Institution", "Specialization", "Graduation Year", "Projects", "Certifications", "Links", "Additional Information"];
const dateFields = (prefix: string) => ["Year", "Month", "Day", "Text"].map((part) => prefix + part);
export const detailFields = {
  Employment: ["id", "position", "employer", "designation", "location", "employmentType", ...dateFields("start"), ...dateFields("end"), "isCurrent", "description", "responsibilities", "achievements", "confidence", "verifiedAt"],
  Education: ["id", "position", "degree", "fieldOfStudy", "institution", "location", ...dateFields("start"), ...dateFields("end"), "grade", "gradeScale", "description", "confidence", "verifiedAt"],
  Projects: ["id", "position", "name", "description", "role", ...dateFields("start"), ...dateFields("end"), "url", "responsibilities", "achievements", "skills", "confidence", "verifiedAt"],
  Certifications: ["id", "position", "name", "issuer", "credentialId", ...dateFields("issue"), ...dateFields("expiry"), "url", "confidence", "verifiedAt"],
  Skills: ["skillId", "canonicalName", "normalizedName", "category", "terms", "originalText", "context", "confidence", "verifiedAt"],
  Links: ["id", "type", "url", "label", "verifiedAt"],
  Additional: ["id", "position", "type", "title", "details", "confidence", "verifiedAt"],
} as const;

// JSON retains array boundaries and embedded delimiters. Scalar null stays blank.
function cellValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}
function partialDate(record: Record<string, unknown>, prefix: string) {
  const year = record[prefix + "Year"];
  if (year == null) return record[prefix + "Text"] ?? null;
  return [year, record[prefix + "Month"], record[prefix + "Day"]]
    .filter((v) => v != null).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-");
}
function lines(records: Record<string, unknown>[], key: string) {
  if (!records.length) return null;
  return records.map((r, i) => `${i + 1}: ${cellValue(r[key]) ?? ""}`).join("\n");
}
export function mapStoredResume(row: StoredExportResume): ResumeExportRow {
  const e = row.extraction, p = row.candidate;
  const employment = p?.employment ?? [], education = p?.education ?? [];
  const highest = highestEducation(education);
  // Match the list's database ordering: PostgreSQL DESC places NULL confidence first.
  const top = [...(p?.skills ?? [])].sort((a, b) =>
    a.confidence == null && b.confidence != null ? -1 :
    b.confidence == null && a.confidence != null ? 1 :
    (b.confidence ?? 0) - (a.confidence ?? 0) || (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0));
  const result: ResumeExportRow = {
    id: row.id, fileName: row.fileName,
    name: e?.name ?? null, email: e?.email ?? null, phone: e?.phone ?? null, designation: e?.designation ?? null,
    nameConfidence: Math.round((e?.nameConfidence ?? 0) * 100),
    emailConfidence: Math.round((e?.emailConfidence ?? 0) * 100),
    phoneConfidence: Math.round((e?.phoneConfidence ?? 0) * 100),
    designationConfidence: Math.round((e?.designationConfidence ?? 0) * 100),
    overallConfidence: Math.round((e?.overallConfidence ?? 0) * 100),
    status: row.status, createdAt: row.createdAt.toISOString(),
    "Other Emails": cellValue(e?.otherEmails), "Phone Country Code": e?.countryCode, "Normalized Phone": e?.normalizedPhone,
    "Highest Qualification": highest?.degree,
    "Qualifications": p?.additional.filter((a) => a.type === "QUALIFICATION").map((a) => cellValue({ title: a.title, details: a.details })).join("\n") || null,
    "Skills": p?.skills.map((s) => s.skill.canonicalName).join("; ") || null,
    "Top Skills": top.slice(0, 5).map((s) => s.skill.canonicalName).join("; ") || null,
    "Employment History": employment.map((j, i) => `${i + 1}: ${j.employer ?? ""} | ${j.designation ?? ""}`).join("\n") || null,
    "Employer": lines(employment, "employer"), "Job Title / Role": lines(employment, "designation"),
    "Employment Start Date": lines(employment.map((j) => ({ date: partialDate(j, "start") })), "date"),
    "Employment End Date": lines(employment.map((j) => ({ date: partialDate(j, "end") })), "date"),
    "Employment Description": lines(employment, "description"),
    "Education": education.map((j, i) => `${i + 1}: ${j.degree ?? ""} | ${j.institution ?? ""}`).join("\n") || null,
    "Degree": lines(education, "degree"), "Institution": lines(education, "institution"),
    "Specialization": lines(education, "fieldOfStudy"), "Graduation Year": lines(education, "endYear"),
    "Projects": lines(p?.projects ?? [], "name"), "Certifications": lines(p?.certifications ?? [], "name"),
    "Links": lines(p?.links ?? [], "url"), "Additional Information": p?.additional.map((a) => `${a.type}: ${a.title ?? ""}`).join("\n") || null,
  };
  profileFields.forEach((key, i) => { result[profileHeaders[i]] = cellValue(p?.[key]); });
  return result;
}

export function createResumeWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
) {
  const sheet = workbook.addWorksheet("Resumes", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sheet.columns = [
    { header: "CV ID", key: "id", width: 24 },
    { header: "File Name", key: "fileName", width: 32 },
    { header: "Name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 32 },
    { header: "Phone", key: "phone", width: 22 },
    { header: "Designation", key: "designation", width: 30 },
    { header: "Name Confidence", key: "nameConfidence", width: 18 },
    { header: "Email Confidence", key: "emailConfidence", width: 18 },
    { header: "Phone Confidence", key: "phoneConfidence", width: 18 },
    {
      header: "Designation Confidence",
      key: "designationConfidence",
      width: 23,
    },
    { header: "Overall Confidence", key: "overallConfidence", width: 20 },
    { header: "Status", key: "status", width: 16 },
    { header: "Created At", key: "createdAt", width: 24 },
  ];
  sheet.columns = [...sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width })), ...comparisonColumns.map((header) => ({ header, key: header, width: 32 }))];
  sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columns.length } };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6652CF" },
  };
  return sheet;
}

export function appendResumeExportRow(
  sheet: Pick<ExcelJS.Worksheet, "addRow">,
  row: ResumeExportRow,
) {
  sheet.addRow(row).commit();
}

export function createResumeExportSheets(workbook: ExcelJS.stream.xlsx.WorkbookWriter) {
  const resumes = createResumeWorksheet(workbook);
  const details = Object.fromEntries(Object.entries(detailFields).map(([name, fields]) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    sheet.columns = ["Resume ID", ...fields].map((header) => ({ header, key: header, width: 28 }));
    sheet.getRow(1).font = { bold: true };
    return [name, sheet];
  })) as Record<keyof typeof detailFields, ExcelJS.Worksheet>;
  const states = workbook.addWorksheet("Value States");
  states.columns = ["Resume ID", "Worksheet", "Record ID", "Field", "State"].map((header) => ({ header, key: header, width: 25 }));
  const overflow = workbook.addWorksheet("Long Values");
  overflow.columns = ["Resume ID", "Worksheet", "Record ID", "Field", "Part", "Value"].map((header) => ({ header, key: header, width: 30 }));
  return { resumes, details, states, overflow };
}
export function appendStoredResume(sheets: ReturnType<typeof createResumeExportSheets>, row: StoredExportResume) {
  function write(sheet: ExcelJS.Worksheet, recordId: string, values: Record<string, unknown>) {
    const cells: Record<string, string | number | boolean | null> = {};
    for (const [field, raw] of Object.entries(values)) {
      let value = cellValue(raw);
      const state = raw == null ? "NULL / absent" : raw === "" ? "Blank" : Array.isArray(raw) && !raw.length ? "Empty array" : null;
      if (state) sheets.states.addRow({ "Resume ID": row.id, Worksheet: sheet.name, "Record ID": recordId, Field: field, State: state }).commit();
      if (typeof value === "string" && value.length > 32767) {
        // Store the complete value in ordered chunks rather than silently truncate it.
        let offset = 0, part = 1;
        while (offset < value.length) {
          let end = Math.min(offset + 32000, value.length);
          if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
          sheets.overflow.addRow({ "Resume ID": row.id, Worksheet: sheet.name, "Record ID": recordId, Field: field, Part: part++, Value: value.slice(offset, end) }).commit();
          offset = end;
        }
        value = `[Full value in Long Values: ${recordId} / ${field}]`;
      }
      // ExcelJS serializes primitive strings as text, including =, +, -, @.
      // Never pass resume content as a formula/hyperlink cell object.
      cells[field] = value;
    }
    sheet.addRow(cells).commit();
  }
  write(sheets.resumes, row.id, mapStoredResume(row));
  const p = row.candidate;
  const records = {
    Employment: p?.employment ?? [], Education: p?.education ?? [], Projects: p?.projects ?? [], Certifications: p?.certifications ?? [],
    Skills: p?.skills.map(({ skill, ...association }) => ({ ...association, ...skill, terms: [...skill.terms].sort((a, b) => a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0) })) ?? [],
    Links: p?.links ?? [], Additional: p?.additional ?? [],
  };
  for (const name of Object.keys(detailFields) as (keyof typeof detailFields)[]) {
    if (!records[name].length) sheets.states.addRow({ "Resume ID": row.id, Worksheet: name, "Record ID": row.id, Field: "Records", State: "No records" }).commit();
    for (const record of records[name]) {
      const input = record as unknown as Record<string, unknown>;
      write(sheets.details[name], String(input.id ?? input.skillId), { "Resume ID": row.id, ...Object.fromEntries(detailFields[name].map((field) => [field, input[field]])) });
    }
  }
}
