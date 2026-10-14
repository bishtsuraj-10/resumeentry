import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractStructuredResume,
  LocalResumeParser,
} from "../lib/resume-parser";
interface SyntheticCase {
  id: string;
  file: string;
  expected: {
    name: string;
    headline: string;
    contact: { email: string; normalizedPhone: string };
  };
  pageTranscripts: { text: string }[];
}
const truth = JSON.parse(
  await readFile(
    path.join(process.cwd(), "test-resumes/ground-truth.json"),
    "utf8",
  ),
) as { resumes: SyntheticCase[] };
describe("synthetic PDF corpus extraction regressions", () => {
  it.each(truth.resumes)(
    "recovers header identity and full role from $id authored content",
    (item) => {
      const parsed = extractStructuredResume(
        item.pageTranscripts.map((p) => p.text).join("\n\f\n"),
      );
      expect(parsed.basic.name?.toLowerCase()).toBe(
        item.expected.name.toLowerCase(),
      );
      expect(parsed.basic.designation?.toLowerCase()).toBe(
        item.expected.headline.toLowerCase(),
      );
      expect(parsed.basic.email).toBe(item.expected.contact.email);
      expect(parsed.basic.normalizedPhone).toBe(
        item.expected.contact.normalizedPhone,
      );
    },
  );
  it.each(["resume-06", "resume-14"])(
    "retains the display-size scanned name in %s with real local OCR",
    async (id) => {
      const item = truth.resumes.find((r) => r.id === id)!;
      const document = await new LocalResumeParser().extractText(
        path.join(process.cwd(), "test-resumes", item.file),
      );
      const parsed = extractStructuredResume(document.text);
      expect(document.usedOcr).toBe(true);
      expect(document.ocrPages).toBe(id === "resume-06" ? 3 : 2);
      expect(parsed.basic.name?.toLowerCase()).toBe(
        item.expected.name.toLowerCase(),
      );
      expect(parsed.basic.designation?.toLowerCase()).toBe(
        item.expected.headline.toLowerCase(),
      );
    },
    60000,
  );
});
