import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { candidateInclude } from "../lib/candidate-data";
import {
  extractStructuredResume,
  LocalResumeParser,
} from "../lib/resume-parser";
import { actualField, evaluationFields } from "../lib/resume-parser/evaluation";
import { reviewDecision } from "../lib/resume-parser/review-policy";
import { accuracyValues, expectedAccuracyFields, type AccuracyCase } from "../lib/resume-parser/corpus-accuracy";

interface Truth {
  asOfDate: string;
  resumes: (AccuracyCase & {
    pageTranscripts: { text: string }[];
  })[];
}
type Count = { tp: number; fp: number; fn: number; missingFields: number };
type Evaluated = {
  id: string;
  fields: Record<string, Count>;
  identity: unknown;
  designation: unknown;
  warnings: string[];
  review: ReturnType<typeof reviewDecision>;
  coverage: Record<string, number>;
};
const normalize = (v: unknown) =>
  String(v).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const values = (v: unknown) =>
  new Set((Array.isArray(v) ? v : [v]).filter((v) => v != null).map(normalize));
function comparison(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  return Object.fromEntries(
    evaluationFields.map((field) => {
      const e = field.endsWith(".url") ? accuracyValues(expected[field], true) : values(expected[field]),
        a = field.endsWith(".url") ? accuracyValues(actual[field], true) : values(actual[field]),
        tp = [...a].filter((v) => e.has(v)).length;
      return [
        field,
        {
          tp,
          fp: a.size - tp,
          fn: e.size - tp,
          missingFields: e.size && !a.size ? 1 : 0,
        },
      ];
    }),
  ) as Record<string, Count>;
}
function summary(cases: { fields: Record<string, Count> }[]) {
  const fields = Object.fromEntries(
    evaluationFields.map((f) => [f, { tp: 0, fp: 0, fn: 0, missingFields: 0 }]),
  );
  for (const c of cases)
    for (const field of evaluationFields)
      for (const key of ["tp", "fp", "fn", "missingFields"] as const)
        fields[field][key] += c.fields[field][key];
  const metrics = (c: Count) => ({
    ...c,
    precision: c.tp + c.fp ? c.tp / (c.tp + c.fp) : null,
    recall: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null,
  });
  const total = Object.values(fields).reduce(
    (a, c) => ({
      tp: a.tp + c.tp,
      fp: a.fp + c.fp,
      fn: a.fn + c.fn,
      missingFields: a.missingFields + c.missingFields,
    }),
    { tp: 0, fp: 0, fn: 0, missingFields: 0 },
  );
  return {
    fields: Object.fromEntries(
      Object.entries(fields).map(([f, c]) => [f, metrics(c)]),
    ),
    totals: metrics(total),
  };
}
async function main() {
  const source = await readFile("test-resumes/ground-truth.json"),
    truth = JSON.parse(source.toString()) as Truth;
  const truthHash = createHash("sha256").update(source).digest("hex"),
    asOf = new Date(truth.asOfDate + "T00:00:00Z");
  const label = process.argv.includes("--before") ? "before" : "after";
  const cachePath = path.join(os.tmpdir(), "resumeentry-m31-" + createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12), "reader-cache.json");
  await mkdir(path.dirname(cachePath), { recursive: true });
  let cache: Record<
    string,
    { text: string; warnings: string[]; ocrPages: number }
  > = {};
  if (
    process.argv.includes("--use-reader-cache") &&
    !process.argv.includes("--reread")
  )
    try {
      cache = JSON.parse(await readFile(cachePath, "utf8"));
    } catch {
      /* first run */
    }
  const parser = new LocalResumeParser(),
    docs: Evaluated[] = [],
    transcripts: Evaluated[] = [];
  for (const item of truth.resumes) {
    const file = path.join("test-resumes", item.file),
      bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
      throw new Error("Synthetic fixture hash mismatch");
    const doc = cache[item.sha256] ?? (await parser.extractText(file));
    cache[item.sha256] = doc;
    await writeFile(cachePath, JSON.stringify(cache));
    for (const [stage, text] of [
      ["pdf", doc.text],
      ["transcript", item.pageTranscripts.map((p) => p.text).join("\n\f\n")],
    ]) {
      const parsed = extractStructuredResume(text, {
        asOf,
        documentWarnings: stage === "pdf" ? doc.warnings : [],
      });
      const actual = Object.fromEntries(
        evaluationFields.map((f) => [f, actualField(parsed, f)]),
      );
      const entry = {
        id: item.id,
        fields: comparison(expectedAccuracyFields(item), actual),
        identity: actual["basic.name"],
        designation: actual["basic.designation"],
        warnings: parsed.warnings,
        // Offline prediction only; production finalization reads these relations
        // back from the database after applying the first-fill persistence policy.
        review: reviewDecision(parsed.basic, {
          locationText: parsed.candidate.profile?.locationText ?? null,
          summary: parsed.candidate.profile?.summary ?? null,
          skills: (parsed.candidate.skills?.upsert ?? []).map((skill) => ({ skill: { canonicalName: skill.name } })),
          links: (parsed.candidate.links?.upsert ?? []).map((link) => ({ url: link.url ?? "" })),
        }),
        coverage: Object.fromEntries(
          (
            [
              "skills",
              "employment",
              "education",
              "projects",
              "certifications",
              "links",
              "additional",
            ] as const
          ).map((s) => [s, parsed.candidate[s]?.upsert?.length ?? 0]),
        ),
      };
      (stage === "pdf" ? docs : transcripts).push(entry);
    }
    console.log(
      JSON.stringify({
        event: "synthetic_evaluation_progress",
        id: item.id,
        ocrPages: doc.ocrPages,
      }),
    );
  }
  const persisted: {
    id: string;
    fields: Record<string, Count>;
    status: string;
    requiresReview: boolean | null;
    confidence: number | null;
    parserVersions: (string | null)[];
    warnings: string[];
    humanEdited: boolean;
    identity: string | null;
    designation: string | null;
    revision: number | null;
  }[] = [];
  let database: { available: boolean; matched: number; reason?: string } = {
    available: false,
    matched: 0,
  };
  const url = process.env.DATABASE_URL;
  if (
    url &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  ) {
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    try {
      const rows = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return tx.resume.findMany({
            where: { fileHash: { in: truth.resumes.map((r) => r.sha256) } },
            include: {
              extraction: true,
              candidate: { include: candidateInclude },
              extractionRuns: {
                include: {
                  evidence: {
                    where: { fieldPath: "document.warnings" },
                    select: { text: true },
                  },
                },
              },
            },
          });
        },
        { timeout: 30000 },
      );
      database = { available: true, matched: rows.length };
      for (const row of rows) {
        const item = truth.resumes.find((r) => r.sha256 === row.fileHash)!;
        const c = row.candidate;
        const date = (v: object, prefix: string) => {
          const r = v as Record<string, unknown>;
          return r[prefix + "Year"] == null
            ? r[prefix + "Text"]
            : [
                r[prefix + "Year"],
                r[prefix + "Month"] != null
                  ? String(r[prefix + "Month"]).padStart(2, "0")
                  : null,
                r[prefix + "Day"] != null
                  ? String(r[prefix + "Day"]).padStart(2, "0")
                  : null,
              ]
                .filter((v) => v != null)
                .join("-");
        };
        const a: Record<string, unknown> = {};
        for (const f of evaluationFields) {
          const [s, k] = f.split(".");
          if (s === "basic")
            a[f] =
              row.extraction?.[k as keyof NonNullable<typeof row.extraction>];
          else if (s === "profile")
            a[f] = c?.[k as keyof NonNullable<typeof c>];
          else if (f === "skills")
            a[f] = c?.skills.map((s) => s.skill.canonicalName);
          else if (f === "projects.skills")
            a[f] = c?.projects.flatMap((p) =>
              p.skills.map((s) => s.skill.canonicalName),
            );
          else {
            const records =
              c?.[
                s as
                  | "employment"
                  | "education"
                  | "projects"
                  | "certifications"
                  | "links"
                  | "additional"
              ] ?? [];
            a[f] = records.map((r) =>
              k.endsWith("Date")
                ? date(
                    r,
                    k.replace("Date", "") === "start"
                      ? "start"
                      : k.replace("Date", ""),
                  )
                : (r as unknown as Record<string, unknown>)[k],
            );
          }
        }
        persisted.push({
          id: item.id,
          fields: comparison(expectedAccuracyFields(item), a),
          status: row.status,
          requiresReview: row.extraction?.requiresReview ?? null,
          confidence: row.extraction?.overallConfidence ?? null,
          parserVersions: row.extractionRuns.map((r) => r.parserVersion),
          warnings: row.extractionRuns.flatMap((r) =>
            r.evidence.flatMap((e) => e.text?.split(/,\s*/) || []),
          ),
          humanEdited: Boolean(
            row.extraction?.reviewedAt ||
            c?.verifiedAt ||
            row.extractionRuns.some((r) => r.method === "HUMAN"),
          ),
          identity: row.extraction?.name ?? null,
          designation: row.extraction?.designation ?? null,
          revision: c?.revision ?? null,
        });
      }
    } catch {
      database = {
        available: false,
        matched: 0,
        reason: "Local database could not be read; no writes attempted.",
      };
    } finally {
      await db.$disconnect();
    }
  } else
    database.reason =
      "Only an explicitly local database is inspected by this read-only evaluator.";
  const report = {
    asOfDate: truth.asOfDate,
    label,
    groundTruthSha256: truthHash,
    readOnly: true,
    threshold: process.env.CONFIDENCE_THRESHOLD ?? "75",
    database,
    pdf: { ...summary(docs), documents: docs },
    authoredTranscript: { ...summary(transcripts), documents: transcripts },
    persisted: { ...summary(persisted), documents: persisted },
    notes: [
      "Exact values after NFKC, case and whitespace normalization; no fuzzy scoring or ground-truth edits.",
      "Metrics are value-set precision/recall; duplicate expected strings count once per field per applicant.",
      "Authored transcripts isolate parser errors; real PDF results include reader/OCR errors; persisted results inspect only records whose document hashes match this synthetic corpus.",
      "Skill aliases and summary line wrapping may affect exact-match scores; review field-level counts rather than confidence alone.",
      "Evidence contains excerpts, not a stored full raw document; full raw text is re-read only from verified synthetic fixtures.",
      "Structured first-fill policy prevents automatic replacement of existing profiles; this evaluator never retries jobs or writes candidates.",
    ],
  };
  await mkdir("docs/evaluation", { recursive: true });
  await writeFile(
    `docs/evaluation/M3.1-${label}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  if (
    createHash("sha256")
      .update(await readFile("test-resumes/ground-truth.json"))
      .digest("hex") !== truthHash
  )
    throw new Error("Ground truth changed");
  console.log(
    JSON.stringify({
      label,
      database,
      pdf: report.pdf.totals,
      transcript: report.authoredTranscript.totals,
      persisted: report.persisted.totals,
    }),
  );
}
void main().catch(() => {
  console.error(
    "Read-only synthetic evaluation failed; no candidate changes were made.",
  );
  process.exitCode = 1;
});
