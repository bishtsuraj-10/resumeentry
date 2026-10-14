import { describe, expect, it } from "vitest";
import path from "node:path";
import { LocalResumeParser } from "../lib/resume-parser";
import { DocumentLimitError } from "../lib/resume-parser/document-reader";
import {
  checkDocxExpansion,
  checkImageDimensions,
} from "../lib/resume-parser/document-limits";
import { extractStructuredResume } from "../lib/resume-parser";
const file = (name: string) =>
  path.join(process.cwd(), "tests/fixtures/m3", name);
describe("local real-document reading", () => {
  it("keeps aligned PDF columns and their section boundaries", async () => {
    const r = await new LocalResumeParser().extractText(file("two-column.pdf"));
    expect(r.usedOcr).toBe(false);
    expect(r.text).toContain("\t");
    const result = extractStructuredResume(r.text);
    expect(result.candidate.skills?.upsert?.map((s) => s.name)).toEqual(
      expect.arrayContaining(["JavaScript", "React", "Docker"]),
    );
    expect(result.candidate.education?.upsert?.[0].institution).toBe(
      "Example Institute",
    );
    expect(r.warnings).toContain("LAYOUT_READING_ORDER_UNCERTAIN");
  });
  it("preserves multiple PDF pages without unnecessary OCR", async () => {
    const r = await new LocalResumeParser().extractText(file("multi-page.pdf"));
    expect(r.pageCount).toBe(2);
    expect(r.ocrPages).toBe(0);
    const result = extractStructuredResume(r.text);
    expect(result.candidate.employment?.upsert?.[0].employer).toBe(
      "Example Multi",
    );
    expect(result.evidence.some((e) => e.location.page === 2)).toBe(true);
  });
  it("preserves DOCX table cells and extracts records", async () => {
    const r = await new LocalResumeParser().extractText(file("table.docx"));
    expect(r.usedOcr).toBe(false);
    expect(r.text).toContain("\t");
    expect(
      extractStructuredResume(r.text).candidate.employment?.upsert?.[0]
        .employer,
    ).toBe("Example Tables");
  });
  it.each(["scan.png", "scan.jpg", "scanned.pdf"])(
    "reads %s with real local OCR",
    async (name) => {
      const r = await new LocalResumeParser().extractText(file(name));
      expect(r.usedOcr).toBe(true);
      expect(r.ocrPages).toBe(1);
      const result = extractStructuredResume(r.text);
      expect(result.basic.email).toBe("alex.morgan@example.com");
      expect(result.basic.name).toBe("Alex Morgan");
      expect(result.candidate.skills?.upsert?.map((s) => s.name)).toEqual(
        expect.arrayContaining(["Python", "SQL"]),
      );
    },
    60000,
  );
  it("rejects byte/page limits before expensive extraction", async () => {
    const parser = new LocalResumeParser();
    await expect(
      parser.extractText(file("scan.png"), { maxBytes: 1 }),
    ).rejects.toBeInstanceOf(DocumentLimitError);
    await expect(
      parser.extractText(file("multi-page.pdf"), { maxPages: 1 }),
    ).rejects.toBeInstanceOf(DocumentLimitError);
  });
  it("OCRs only the deficient page of a mixed text/scanned PDF", async () => {
    const r = await new LocalResumeParser().extractText(file("mixed.pdf"));
    expect(r.pageCount).toBe(2);
    expect(r.ocrPages).toBe(1);
    expect(
      extractStructuredResume(r.text).candidate.skills?.upsert?.map(
        (s) => s.name,
      ),
    ).toContain("Python");
  }, 60000);
  it("honors cancellation and deadlines", async () => {
    const signal = AbortSignal.abort();
    await expect(
      new LocalResumeParser().extractText(file("scan.png"), { signal }),
    ).rejects.toThrow();
    await expect(
      new LocalResumeParser().extractText(file("scanned.pdf"), {
        timeoutMs: 1,
      }),
    ).rejects.toThrow();
  });
  it("rejects oversized expanded archives and image dimensions without decoding", () => {
    const zip = Buffer.alloc(46);
    zip.writeUInt32LE(0x02014b50);
    zip.writeUInt32LE(51 * 1024 * 1024, 24);
    expect(() => checkDocxExpansion(zip)).toThrow(DocumentLimitError);
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(20000, 16);
    png.writeUInt32BE(20000, 20);
    expect(() => checkImageDimensions(png)).toThrow(DocumentLimitError);
  });
});
