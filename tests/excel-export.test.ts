import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { appendStoredResume, createResumeWorksheet, mapStoredResume, resumeExportInclude, type StoredExportResume } from "../lib/excel-export";

const mock = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), find: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiSession: mock.auth, session: mock.session }));
vi.mock("@/lib/db", () => ({ db: { resume: { findMany: mock.find }, auditLog: { create: mock.audit } } }));
import { GET } from "../app/api/export/route";

function fixture(id = "fixture-1", full = true): StoredExportResume {
  // Synthetic persisted payload: no real candidate records or database writes.
  const dates = { startYear: 2020, startMonth: null, startDay: null, startText: "2020", endYear: 2022, endMonth: 6, endDay: null, endText: "June 2022" };
  return {
    id, fileName: "synthetic.pdf", status: "REVIEW", createdAt: new Date("2026-10-01T00:00:00Z"),
    extraction: { name: "Corrected Candidate", email: "fixture@example.test", phone: "+14155550100", designation: "Corrected Role",  countryCode: "+1", normalizedPhone: "+14155550100", nameConfidence: .9, emailConfidence: .99, phoneConfidence: .96, designationConfidence: .86, overallConfidence: .9275, reviewedAt: new Date() },
    candidate: full ? {
      resumeId: id,
      locationText: "Stored Location",    dateOfBirth: new Date("1990-01-01T00:00:00Z"), headline: "Stored Headline", summary: "Corrected summary", objective: "Stored Objective", totalExperienceMonths: 30, noticePeriod: "30 days", employmentPreferences: ["Remote"],
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
  const sheet = createResumeWorksheet(writer);
  rows.forEach((row) => appendStoredResume(sheet, row));
  await sheet.commit();
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
  it("exports exactly one Resumes sheet with the exact approved 21 columns and mappings", async () => {
    const book = await workbookFor([fixture()]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Resumes"]);
    expect(book.getWorksheet("Resumes")!.columnCount).toBe(21);
    expect((book.getWorksheet("Resumes")!.getRow(1).values as string[]).slice(1)).toEqual(["CV ID", "File Name", "Name", "Email", "Phone", "Designation", "Location", "Headline", "Summary", "Total Experience (Months)", "Employment History", "Highest Qualification", "Education", "Skills", "Projects", "Certifications", "Links", "Additional Information", "Status", "Overall Confidence", "Created At"]);
    expect(value(book, "Resumes", "CV ID")).toBe("fixture-1");
    expect(value(book, "Resumes", "File Name")).toBe("synthetic.pdf");
    expect(value(book, "Resumes", "Name")).toBe("Corrected Candidate");
    expect(value(book, "Resumes", "Email")).toBe("fixture@example.test");
    expect(value(book, "Resumes", "Phone")).toBe("+14155550100");
    expect(value(book, "Resumes", "Designation")).toBe("Corrected Role");
    expect(value(book, "Resumes", "Overall Confidence")).toBe(93);
    expect(value(book, "Resumes", "Summary")).toBe("Corrected summary");
    expect(value(book, "Resumes", "Location")).toBe("Stored Location");
    expect(value(book, "Resumes", "Headline")).toBe("Stored Headline");
    expect(value(book, "Resumes", "Highest Qualification")).toBe("Master of Science");
    expect(value(book, "Resumes", "Additional Information")).toContain("Stored qualification");
    expect(value(book, "Resumes", "Total Experience (Months)")).toBe(30);
    expect(value(book, "Resumes", "Skills")).toContain("Skill 0");
    expect(value(book, "Resumes", "Status")).toBe("REVIEW");
    expect(value(book, "Resumes", "Created At")).toBe("2026-10-01T00:00:00.000Z");
    const sheet = book.getWorksheet("Resumes")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:U1");
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.getRow(2).getCell(9).alignment.wrapText).toBe(true);
    expect(sheet.getRow(2).getCell(20).numFmt).toBe('0"%"');
  });
  it("exports basic-only records with every optional column present and blank", async () => {
    const book = await workbookFor([fixture("basic", false)]);
    for (const header of ["Location", "Headline", "Summary", "Total Experience (Months)", "Employment History", "Education", "Skills", "Projects", "Certifications", "Links", "Additional Information", "Highest Qualification"]) expect(value(book, "Resumes", header)).toBeNull();
    expect(book.worksheets).toHaveLength(1);
    expect(book.getWorksheet("Resumes")!.columnCount).toBe(21);
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
  it("retains every child record in its cell with no duplicated parent rows", async () => {
    const second = fixture("fixture-2"); second.status = "COMPLETED";
    const book = await workbookFor([fixture(), second]);
    expect(book.getWorksheet("Resumes")!.rowCount).toBe(3);
    expect(value(book, "Resumes", "CV ID", 2)).toBe("fixture-1");
    expect(value(book, "Resumes", "CV ID", 3)).toBe("fixture-2");
    expect(value(book, "Resumes", "Status", 3)).toBe("COMPLETED");
    for (const fragment of ["1. Employer: Employer 0", "2. Employer: Employer 1", "Designation: Role 0", "Start Date: 2020", "End Date: 2022-06 (original: June 2022)", "Description: Description 0", "Description: Description 1", "First; responsibility", "Second responsibility", "Achievement", "Current: false"]) expect(value(book, "Resumes", "Employment History")).toContain(fragment);
    for (const fragment of ["Bachelor of Science", "Master of Science", "Institution 0", "Institution 1", "Specialization: Computing", "Start Date: 2020", "Grade: A", "Grade Scale: Letter", "Course description"]) expect(value(book, "Resumes", "Education")).toContain(fragment);
    for (let i = 0; i < 7; i++) {
      expect(value(book, "Resumes", "Skills")).toContain(`Skill ${i}`);
      expect(value(book, "Resumes", "Skills")).toContain(`Alias ${i}`);
      expect(value(book, "Resumes", "Skills")).toContain(`Original ${i}`);
    }
    for (const fragment of ["Name: Project", "Project description", "Role: Lead", "Start Date: 2020", "Skill 1", "Design", "Shipped", "https://example.test/project"]) expect(value(book, "Resumes", "Projects")).toContain(fragment);
    for (const fragment of ["Name: Certification", "Issuer: Issuer", "Credential ID: cred-1", "Issue Date: 2022", "https://example.test/credential"]) expect(value(book, "Resumes", "Certifications")).toContain(fragment);
    expect(value(book, "Resumes", "Links")).toContain("Type: GITHUB");
    expect(value(book, "Resumes", "Links")).toContain("https://example.test/profile");
    for (const fragment of ["Type: QUALIFICATION", "Stored qualification", "Stored details", '"retained": true']) expect(value(book, "Resumes", "Additional Information")).toContain(fragment);
  });
  it("does not mutate source records and orders shuffled records/JSON deterministically", async () => {
    const row = fixture(); const before = structuredClone(row);
    const expected = mapStoredResume(row);
    await workbookFor([row]); expect(row).toEqual(before);
    row.candidate!.employment.reverse(); row.candidate!.education.reverse(); row.candidate!.skills.reverse();
    row.candidate!.additional[0].details = { nested: { retained: true }, description: "Stored details" };
    expect(mapStoredResume(row)).toEqual(expected);
    expect(value(await workbookFor([row]), "Resumes", "Employment History")).toContain("2. Employer: Employer 1");
  });
  it("retains multiple projects, certifications, links and additional entries in deterministic order", async () => {
    const row = fixture(), p = row.candidate!;
    p.projects.push({ ...p.projects[0], id: "project-2", position: 1, name: "Second Project", description: "Second description" });
    p.certifications.push({ ...p.certifications[0], id: "cert-2", position: 1, name: "Second Certification", credentialId: "cred-2" });
    p.links.push({ ...p.links[0], id: "link-2", type: "LINKEDIN", url: "https://example.test/second" });
    p.additional.push({ ...p.additional[0], id: "additional-2", position: 1, type: "LANGUAGE", title: "Example Language", details: { proficiency: "Stored proficiency" } });
    const expected = mapStoredResume(row);
    p.projects.reverse(); p.certifications.reverse(); p.links.reverse(); p.additional.reverse();
    expect(mapStoredResume(row)).toEqual(expected);
    const book = await workbookFor([row]);
    expect(value(book, "Resumes", "Projects")).toContain("2. Name: Second Project");
    expect(value(book, "Resumes", "Projects")).toContain("Second description");
    expect(value(book, "Resumes", "Certifications")).toContain("2. Name: Second Certification");
    expect(value(book, "Resumes", "Certifications")).toContain("cred-2");
    expect(value(book, "Resumes", "Links")).toContain("2. Type: LINKEDIN");
    expect(value(book, "Resumes", "Links")).toContain("https://example.test/second");
    expect(value(book, "Resumes", "Additional Information")).toContain("2. Type: LANGUAGE");
    expect(value(book, "Resumes", "Additional Information")).toContain("Stored proficiency");
  });
  it.each(["=HYPERLINK(\"https://example.test\")", "+SUM(1,1)", "-1+2", "@SUM(A1)", "\t=1+1"])("writes untrusted content as text: %s", async (text) => {
    const row = fixture(); row.extraction!.name = text; row.candidate!.employment[0].description = text;
    const book = await workbookFor([row]);
    expect(value(book, "Resumes", "Name")).toBe(text); expect(value(book, "Resumes", "Employment History")).toContain(text);
    expect(book.getWorksheet("Resumes")!.getRow(2).getCell(3).type).toBe(ExcelJS.ValueType.String);
  });
  it("preserves the exact Excel cell boundary and rejects overflow before adding a row", async () => {
    const row = fixture(); row.candidate!.summary = "A".repeat(32765) + "😀";
    expect(value(await workbookFor([row]), "Resumes", "Summary")).toBe(row.candidate!.summary);
    row.candidate!.summary += "B";
    const addRow = vi.fn();
    expect(() => appendStoredResume({ addRow }, row)).toThrow('Excel cell limit exceeded for "Summary"');
    expect(addRow).not.toHaveBeenCalled();
  });
  it("uses the current persisted value without identity fallback after a correction clears it", () => {
    const row = fixture(); row.extraction!.name = null; row.extraction!.designation = null;
    expect(mapStoredResume(row).name).toBeNull(); expect(mapStoredResume(row).designation).toBeNull();
  });
  it("keeps missing extraction blank without profile identity fallback", async () => {
    const row = fixture(); row.extraction = null;
    const book = await workbookFor([row]);
    for (const field of ["Name", "Email", "Phone", "Designation"]) expect(value(book, "Resumes", field)).toBeNull();
    expect(value(book, "Resumes", "Overall Confidence")).toBe(0);
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
  it("fails an oversized streamed download rather than truncating or adding sheets", async () => {
    const row = fixture(); row.candidate!.employment[0].description = "A".repeat(32767);
    mock.find.mockResolvedValue([row]);
    const response = await GET(new Request("http://localhost/api/export"));
    await expect(response.arrayBuffer()).rejects.toThrow('Excel cell limit exceeded for "Employment History"');
    expect(mock.audit).not.toHaveBeenCalled();
  });
});
