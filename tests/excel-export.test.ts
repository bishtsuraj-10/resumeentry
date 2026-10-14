import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { appendStoredResume, createResumeExportSheets, mapStoredResume, resumeExportInclude, type StoredExportResume } from "../lib/excel-export";

const mock = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), find: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiSession: mock.auth, session: mock.session }));
vi.mock("@/lib/db", () => ({ db: { resume: { findMany: mock.find }, auditLog: { create: mock.audit } } }));
import { GET } from "../app/api/export/route";

function fixture(id = "fixture-1", full = true): StoredExportResume {
  // Synthetic persisted payload: no real candidate records or database writes.
  const dates = { startYear: 2020, startMonth: null, startDay: null, startText: "2020", endYear: 2022, endMonth: 6, endDay: null, endText: "June 2022" };
  return {
    id, fileName: "synthetic.pdf", status: "REVIEW", createdAt: new Date("2026-10-01T00:00:00Z"),
    extraction: { name: "Corrected Candidate", email: "fixture@example.test", phone: "+14155550100", designation: "Corrected Role", otherEmails: ["other@example.test"], countryCode: "+1", normalizedPhone: "+14155550100", nameConfidence: .9, emailConfidence: .99, phoneConfidence: .96, designationConfidence: .86, overallConfidence: .9275, reviewedAt: new Date() },
    candidate: full ? {
      resumeId: id, firstName: "Corrected", lastName: "Candidate", additionalEmails: ["extra@example.test"], additionalPhones: [{ originalText: "+14155550101", normalizedPhone: "+14155550101", countryCode: "+1" }],
      locationText: "Stored Location", city: "Example City", region: "Example State", country: "Example Country", dateOfBirth: new Date("1990-01-01T00:00:00Z"), headline: "Stored Headline", summary: "Corrected summary", objective: "Stored Objective", totalExperienceMonths: 30, noticePeriod: "30 days", employmentPreferences: ["Remote"],
      employment: [0, 1].map((position) => ({ id: `job-${position}`, resumeId: id, position, employer: `Employer ${position}`, designation: `Role ${position}`, location: "Location", employmentType: "Full time", ...dates, isCurrent: false, description: `Description ${position}`, responsibilities: ["First; responsibility", "Second responsibility"], achievements: ["Achievement"], confidence: .8, verifiedAt: null })),
      education: [0, 1].map((position) => ({ id: `edu-${position}`, resumeId: id, position, degree: position ? "Master of Science" : "Bachelor of Science", institution: `Institution ${position}`, fieldOfStudy: "Computing", location: "Campus", ...dates, grade: "A", gradeScale: "Letter", description: "Course description", confidence: .9, verifiedAt: null })),
      skills: Array.from({ length: 7 }, (_, i) => ({ resumeId: id, skillId: `skill-${i}`, originalText: `Original ${i}`, context: "Employment", confidence: i / 10, verifiedAt: null, skill: { id: `skill-${i}`, canonicalName: `Skill ${i}`, normalizedName: `skill ${i}`, category: "Technical", terms: [{ normalizedName: `alias ${i}`, displayName: `Alias ${i}`, skillId: `skill-${i}` }] } })),
      projects: [{ id: "project-1", position: 0, name: "Project", description: "Project description", role: "Lead", ...dates, url: "https://example.test/project", responsibilities: ["Design"], achievements: ["Shipped"], confidence: .9, verifiedAt: null, skills: [{ skillId: "skill-1", skill: { canonicalName: "Skill 1" } }] }],
      certifications: [{ id: "cert-1", position: 0, name: "Certification", issuer: "Issuer", credentialId: "cred-1", issueYear: 2022, issueMonth: null, issueDay: null, issueText: "2022", expiryYear: null, expiryMonth: null, expiryDay: null, expiryText: null, url: "https://example.test/credential", confidence: .9, verifiedAt: null }],
      links: [{ id: "link-1", type: "GITHUB", url: "https://example.test/profile", label: "Profile", verifiedAt: null }],
      additional: [{ id: "additional-1", position: 0, type: "QUALIFICATION", title: "Stored qualification", details: { description: "Stored details", nested: { retained: true } }, confidence: .8, verifiedAt: null }],
    } : null,
  } as unknown as StoredExportResume;
}
async function workbookFor(rows: StoredExportResume[]) {
  const output = new PassThrough(), chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
  const sheets = createResumeExportSheets(writer);
  rows.forEach((row) => appendStoredResume(sheets, row));
  for (const sheet of [sheets.resumes, ...Object.values(sheets.details), sheets.states, sheets.overflow]) await sheet.commit();
  await writer.commit();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(Buffer.concat(chunks)).buffer);
  return workbook;
}
function value(workbook: ExcelJS.Workbook, sheetName: string, header: string, row = 2) {
  const sheet = workbook.getWorksheet(sheetName)!;
  const columns = sheet.getRow(1).values as string[];
  return sheet.getRow(row).getCell(columns.indexOf(header)).value;
}
beforeEach(() => {
  vi.resetAllMocks(); mock.auth.mockResolvedValue(null); mock.session.mockResolvedValue({ id: "synthetic-actor" }); mock.find.mockResolvedValue([]); mock.audit.mockResolvedValue({});
});
describe("persisted Excel export", () => {
  it("retains the original 13 column meanings and exports supported profile fields", async () => {
    const book = await workbookFor([fixture()]);
    expect((book.getWorksheet("Resumes")!.getRow(1).values as string[]).slice(1, 14)).toEqual(["CV ID", "File Name", "Name", "Email", "Phone", "Designation", "Name Confidence", "Email Confidence", "Phone Confidence", "Designation Confidence", "Overall Confidence", "Status", "Created At"]);
    expect(value(book, "Resumes", "Name")).toBe("Corrected Candidate");
    expect(value(book, "Resumes", "Designation")).toBe("Corrected Role");
    expect(value(book, "Resumes", "Overall Confidence")).toBe(93);
    expect(value(book, "Resumes", "Summary")).toBe("Corrected summary");
    expect(value(book, "Resumes", "State / Region")).toBe("Example State");
    expect(value(book, "Resumes", "Highest Qualification")).toBe("Master of Science");
    expect(value(book, "Resumes", "Qualifications")).toContain("Stored qualification");
    expect(value(book, "Resumes", "Total Experience (Months)")).toBe(30);
    expect(value(book, "Resumes", "Additional Phones")).toContain("originalText");
    expect(value(book, "Resumes", "Top Skills")).toBe("Skill 6; Skill 5; Skill 4; Skill 3; Skill 2");
    expect(value(book, "Resumes", "Skills")).toContain("Skill 0");
  });
  it("exports basic-only records and all empty relation worksheets without inventing values", async () => {
    const book = await workbookFor([fixture("basic", false)]);
    for (const header of ["Location", "Summary", "Total Experience (Months)", "Skills", "Highest Qualification"]) expect(value(book, "Resumes", header)).toBeNull();
    expect(book.getWorksheet("Employment")!.rowCount).toBe(1);
    expect(value(book, "Resumes", "CV ID")).toBe("basic");
  });
  it("preserves missing location and experience while retaining explicit zero and text", async () => {
    const missing = fixture(); missing.candidate!.locationText = null; missing.candidate!.totalExperienceMonths = null; missing.extraction!.designation = "Not Identified";
    const zero = fixture("zero"); zero.candidate!.totalExperienceMonths = 0;
    const book = await workbookFor([missing, zero]);
    expect(value(book, "Resumes", "Location")).toBeNull();
    expect(value(book, "Resumes", "Total Experience (Months)")).toBeNull();
    expect(value(book, "Resumes", "Designation")).toBe("Not Identified");
    expect(value(book, "Resumes", "Total Experience (Months)", 3)).toBe(0);
  });
  it("retains every employment, education, skill and project technology with correct Resume IDs", async () => {
    const second = fixture("fixture-2"); second.status = "COMPLETED";
    const book = await workbookFor([fixture(), second]);
    expect(book.getWorksheet("Resumes")!.rowCount).toBe(3);
    for (const [name, count] of [["Employment", 4], ["Education", 4], ["Skills", 14], ["Projects", 2], ["Certifications", 2], ["Links", 2], ["Additional", 2]] as const) {
      const sheet = book.getWorksheet(name)!; expect(sheet.rowCount).toBe(count + 1);
      const ids: string[] = []; sheet.eachRow((r, i) => { if (i > 1) ids.push(String(r.getCell(1).value)); });
      expect(ids.filter((id) => id === "fixture-1")).toHaveLength(count / 2); expect(ids.filter((id) => id === "fixture-2")).toHaveLength(count / 2);
    }
    expect(value(book, "Employment", "startYear")).toBe(2020); expect(value(book, "Employment", "startMonth")).toBeNull();
    expect(value(book, "Employment", "responsibilities")).toBe('["First; responsibility","Second responsibility"]');
    expect(value(book, "Projects", "skills")).toContain("Skill 1"); expect(value(book, "Skills", "terms")).toContain("Alias 0");
    expect(value(book, "Additional", "details")).toContain('"retained":true');
  });
  it("distinguishes stored NULL and blank through Value States", async () => {
    const row = fixture(); row.candidate!.summary = null; row.candidate!.objective = "";
    const book = await workbookFor([row]); const states: unknown[][] = [];
    book.getWorksheet("Value States")!.eachRow((r, i) => { if (i > 1) states.push(r.values as unknown[]); });
    expect(states.some((r) => r.includes("Summary") && r.includes("NULL / absent"))).toBe(true);
    expect(states.some((r) => r.includes("Objective") && r.includes("Blank"))).toBe(true);
  });
  it.each(["=HYPERLINK(\"https://example.test\")", "+SUM(1,1)", "-1+2", "@SUM(A1)", "\t=1+1"])("writes untrusted content as text: %s", async (text) => {
    const row = fixture(); row.extraction!.name = text; row.candidate!.employment[0].description = text;
    const book = await workbookFor([row]);
    expect(value(book, "Resumes", "Name")).toBe(text); expect(value(book, "Employment", "description")).toBe(text);
    expect(book.getWorksheet("Resumes")!.getRow(2).getCell(3).type).toBe(ExcelJS.ValueType.String);
  });
  it("preserves oversized values in ordered chunks without breaking Excel's cell limit", async () => {
    const row = fixture(); const text = "A".repeat(31999) + "😀" + "B".repeat(35000); row.candidate!.summary = text;
    const book = await workbookFor([row]); expect(value(book, "Resumes", "Summary")).toContain("Long Values");
    const chunks: string[] = []; book.getWorksheet("Long Values")!.eachRow((r, i) => { if (i > 1 && r.getCell(4).value === "Summary") chunks.push(String(r.getCell(6).value)); });
    expect(chunks.join("")).toBe(text); expect(chunks.every((s) => s.length <= 32767)).toBe(true);
  });
  it("uses the current persisted value without identity fallback after a correction clears it", () => {
    const row = fixture(); row.extraction!.name = null; row.extraction!.designation = null;
    expect(mapStoredResume(row).name).toBeNull(); expect(mapStoredResume(row).designation).toBeNull();
  });
  it("matches the existing top five rule including null-confidence ordering", () => {
    const row = fixture(); row.candidate!.skills[0].confidence = null;
    expect(mapStoredResume(row)["Top Skills"]).toBe("Skill 0; Skill 6; Skill 5; Skill 4; Skill 3");
  });
});
describe("Excel API", () => {
  it.each([401, 403])("enforces export permission before database access (%s)", async (status) => {
    mock.auth.mockResolvedValue(new Response(null, { status })); expect((await GET(new Request("http://localhost/api/export"))).status).toBe(status);
    expect(mock.auth).toHaveBeenCalledWith("resumes.export"); expect(mock.find).not.toHaveBeenCalled();
  });
  it("requires an authenticated actor and rejects unsupported status", async () => {
    mock.session.mockResolvedValue(null); expect((await GET(new Request("http://localhost/api/export"))).status).toBe(401);
    mock.session.mockResolvedValue({ id: "actor" }); expect((await GET(new Request("http://localhost/api/export?status=PROCESSING"))).status).toBe(400); expect(mock.find).not.toHaveBeenCalled();
  });
  it.each(["ALL", "REVIEW", "COMPLETED", "FAILED", "DUPLICATE", "CANCELLED", "REVIEWED"])("preserves %s filtering and streams a valid workbook", async (status) => {
    mock.find.mockResolvedValue([fixture()]); const response = await GET(new Request(`http://localhost/api/export?status=${status}`));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
    expect(value(book, "Resumes", "Summary")).toBe("Corrected summary"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock.find.mock.calls[0][0]).toMatchObject({ include: resumeExportInclude, take: 500, orderBy: { id: "asc" }, where: status === "ALL" ? {} : status === "REVIEWED" ? { extraction: { is: { reviewedAt: { not: null } } } } : { status } });
  });
  it("paginates parent records without multiplying rows across child relations", async () => {
    mock.find.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => fixture(`parent-${String(i).padStart(3, "0")}`, false))).mockResolvedValueOnce([fixture("parent-500", false)]);
    const response = await GET(new Request("http://localhost/api/export")); const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
    expect(book.getWorksheet("Resumes")!.rowCount).toBe(502); expect(mock.find.mock.calls[1][0]).toMatchObject({ skip: 1, cursor: { id: "parent-499" } });
  }, 30000);
  it("surfaces database failure as a failed download", async () => {
    mock.find.mockRejectedValue(new Error("Synthetic DB failure")); const response = await GET(new Request("http://localhost/api/export")); await expect(response.arrayBuffer()).rejects.toThrow("Synthetic DB failure");
  });
});
