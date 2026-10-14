import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { LocalResumeParser, extractStructuredResume, PARSER_VERSION } from "../lib/resume-parser";
import { accuracyFor, type AccuracyCase } from "../lib/resume-parser/corpus-accuracy";
import { evaluationFields } from "../lib/resume-parser/evaluation";

async function main() {
  const source = await readFile("test-resumes/ground-truth.json");
  const truth = JSON.parse(source.toString()) as { asOfDate: string; resumes: AccuracyCase[] };
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const asOf = new Date(truth.asOfDate + "T00:00:00Z");
  const reader = new LocalResumeParser();
  const documents: (ReturnType<typeof accuracyFor> & { sourceSha256: string; ocrPages: number })[] = [];
  for (const item of truth.resumes) {
    const file = path.join("test-resumes", item.file);
    if (hash(await readFile(file)) !== item.sha256) throw new Error(`Hash mismatch: ${item.id}`);
    const document = await reader.extractText(file);
    const parsed = extractStructuredResume(document.text, { asOf, documentWarnings: document.warnings });
    const accuracy = accuracyFor(item, parsed, asOf);
    documents.push({ ...accuracy, sourceSha256: item.sha256, ocrPages: document.ocrPages });
    console.log(JSON.stringify({ id: item.id, eligibility: accuracy.automaticCompletion, links: accuracy.fields["links.url"], summary: { tp: accuracy.fields["profile.summary"].tp, fn: accuracy.fields["profile.summary"].fn } }));
  }
  const fields = Object.fromEntries(evaluationFields.map(field => [field, documents.reduce((a, d) => ({ tp: a.tp + d.fields[field].tp, fp: a.fp + d.fields[field].fp, fn: a.fn + d.fields[field].fn }), { tp: 0, fp: 0, fn: 0 })]));
  const report = {
    parserVersion: PARSER_VERSION, asOfDate: truth.asOfDate, groundTruthSha256: hash(source),
    databaseAccess: false, sourcePdfCount: documents.length, fields, documents,
    notes: [
      "Fresh original PDF reads including local OCR; every source hash verified. No database access, cache reuse, or ground-truth edits.",
      "Field exactness uses only NFKC, case, whitespace and safe URL scheme normalization; employment tuples preserve record association and duplicate counts.",
      "Profile links, project URLs and certification URLs have separate targets. The historical flattened links target included project URLs.",
      "Raw total-experience benchmark mismatches remain in field metrics. Convention accuracy is scored independently from month-precision ground-truth employment tuples: completed end months included, current month excluded.",
      "Automatic completion is an offline prediction from fresh parser output. Production eligibility still reads saved relations; existing records are not reprocessed.",
    ],
  };
  if (hash(await readFile("test-resumes/ground-truth.json")) !== hash(source)) throw new Error("Ground truth changed");
  await mkdir("docs/evaluation", { recursive: true });
  await writeFile("docs/evaluation/M3.6-parser-accuracy.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ fields, eligibility: documents.map(d => [d.id, d.automaticCompletion]), experience: documents.map(d => [d.id, d.experience]) }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
