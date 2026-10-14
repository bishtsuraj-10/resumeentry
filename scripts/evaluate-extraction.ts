import { writeFile, mkdir } from "node:fs/promises";
import { corpus } from "../tests/fixtures/m3-corpus";
import { evaluateCorpus } from "../lib/resume-parser/evaluation";
import { LocalResumeParser } from "../lib/resume-parser";
import { assessTextQuality } from "../lib/resume-parser/text-normalizer";
async function main() {
  const report = evaluateCorpus(corpus);
  const reading = [];
  for (const [file, id] of [
    ["two-column.pdf", "two-column"],
    ["multi-page.pdf", "multi-page"],
    ["table.docx", "table"],
    ["scan.png", "scanned-transcript"],
    ["scan.jpg", "scanned-transcript"],
    ["scanned.pdf", "scanned-transcript"],
    ["mixed.pdf", "scanned-transcript"],
  ]) {
    const doc = await new LocalResumeParser().extractText(
      "tests/fixtures/m3/" + file,
    );
    const expected = corpus.find((c) => c.id === id)!.expected;
    const extracted = evaluateCorpus([{ id: file, text: doc.text, expected }]);
    reading.push({
      format: file.split(".").pop(),
      fixture: file,
      documentMs: doc.durationMs,
      pageCount: doc.pageCount,
      ocrPages: doc.ocrPages,
      usedOcr: doc.usedOcr,
      quality: assessTextQuality(doc.text),
      warnings: doc.warnings,
      extraction: extracted.totals,
    });
  }
  await mkdir("docs/evaluation", { recursive: true });
  await writeFile(
    "docs/evaluation/M3-extraction.json",
    JSON.stringify({ ...report, reading }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      documentCount: report.documentCount,
      documentSuccess: report.documentSuccess,
      ...report.totals,
    }),
  );
}
void main().catch(() => {
  console.error("Extraction evaluation failed");
  process.exitCode = 1;
});
