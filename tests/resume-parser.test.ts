import { describe, expect, it } from "vitest";
import path from "node:path";
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { extractResumeFields, isCandidateDuplicate, LocalResumeParser } from "../lib/resume-parser";
import { appendResumeExportRow, createResumeWorksheet } from "../lib/excel-export";

const resume = `RAHUL SHARMA
Senior Software Engineer
Email: Rahul.Sharma@gmail.com
Phone: +91 98765 43210
Experience
Software Engineer 2019-2021
Senior Software Engineer 2021-Present`;

describe("resume extraction", () => {
  it("extracts and normalizes email addresses", () => {
    expect(extractResumeFields(resume).email).toBe("rahul.sharma@gmail.com");
  });
  it("extracts a valid international phone and E.164 value", () => {
    const result = extractResumeFields(resume);
    expect(result.normalizedPhone).toBe("+919876543210");
    expect(result.countryCode).toBe("+91");
  });
  it("extracts a likely name from the resume header", () => {
    expect(extractResumeFields(resume).name).toBe("Rahul Sharma");
    expect(extractResumeFields("Senior Software Engineer\nEmail: a@b.com", "alex_jones.pdf").name).toBe("Alex Jones");
  });
  it("selects the latest matching designation from experience", () => {
    expect(extractResumeFields(resume).designation).toBe("Senior Software Engineer");
    expect(extractResumeFields("Experience\nSoftware Engineer\n2019-2021\nSenior Software Engineer\n2021-2024\nEngineering Manager\n2024-Present").designation).toBe("Engineering Manager");
  });
  it("detects candidate duplicates by email or normalized phone", () => {
    const first = extractResumeFields(resume);
    expect(isCandidateDuplicate(first, { ...first, email: "other@example.com" })).toBe(true);
    expect(isCandidateDuplicate(first, { ...first, email: "other@example.com", normalizedPhone: "+14155551234" })).toBe(false);
  });
  it("declares supported document and image formats", () => {
    const parser = new LocalResumeParser();
    expect(parser.canParse(".pdf")).toBe(true);
    expect(parser.canParse(".docx")).toBe(true);
    expect(parser.canParse(".jpg")).toBe(true);
    expect(parser.canParse(".exe")).toBe(false);
  });
  it("extracts text from a real DOCX document", async () => {
    const parser = new LocalResumeParser();
    const result = await parser.extractText(path.join(process.cwd(), "tests", "fixtures", "sample-resume.docx"));
    expect(result.text).toContain("Casey Jordan");
    expect(result.text).toContain("casey.jordan@example.com");
    expect(result.usedOcr).toBe(false);
  });
  it("extracts text from a real text-based PDF", async () => {
    const parser = new LocalResumeParser();
    const result = await parser.extractText(path.join(process.cwd(), "tests", "fixtures", "sample-resume.pdf"));
    expect(result.text).toContain("Jordan Casey");
    expect(result.text).toContain("jordan.casey@example.com");
    expect(result.usedOcr).toBe(false);
  });
  it("rejects unsupported formats with a useful parser error", async () => {
    const parser = new LocalResumeParser();
    await expect(parser.extractText("invalid-resume.doc")).rejects.toThrow("Unsupported resume format");
  });
  it("surfaces malformed PDF extraction errors", async () => {
    const parser = new LocalResumeParser();
    await expect(parser.extractText(path.join(process.cwd(), "tests", "fixtures", "corrupt.pdf"))).rejects.toThrow();
  });
  it("writes an Excel workbook with candidate columns and values", async () => {
    const output = new PassThrough(); const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useSharedStrings: false });
    const sheet = createResumeWorksheet(workbook);
    appendResumeExportRow(sheet, { id: "cv-1", fileName: "casey.docx", name: "Casey Jordan", email: "casey.jordan@example.com", phone: "+91 98765 43210", designation: "Data Analyst", nameConfidence: 90, emailConfidence: 99, phoneConfidence: 96, designationConfidence: 86, overallConfidence: 93, status: "COMPLETED", createdAt: "2026-10-08T00:00:00.000Z" });
    await sheet.commit(); await workbook.commit();
    const parsed = new ExcelJS.Workbook(); const buffer = Buffer.concat(chunks); await parsed.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    expect(parsed.getWorksheet("Resumes")?.getRow(2).getCell(3).value).toBe("Casey Jordan");
    expect(parsed.getWorksheet("Resumes")?.getRow(2).getCell(20).value).toBe(93);
  });
});
