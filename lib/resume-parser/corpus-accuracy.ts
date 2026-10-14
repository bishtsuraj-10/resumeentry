import { actualField, evaluationFields } from "./evaluation";
import type { StructuredExtraction } from "./index";
import { reviewDecision } from "./review-policy";
import { experienceMonths } from "./validators/dates";
import { safeUrlSchema } from "../candidate-validation";

export interface AccuracyCase {
  id: string;
  file: string;
  sha256: string;
  expectedFields: Record<string, unknown>;
  expected: {
    links: { url: string }[];
    projects: { url?: string | null }[];
    certifications: { url?: string | null }[];
    employment: { employer: string; designation: string; startDate: string | null; endDate: string | null; isCurrent: boolean }[];
  };
}
const normalized = (value: unknown) => String(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const canonicalUrl = (value: string) => safeUrlSchema.parse(/^https?:/i.test(value) ? value : "https://" + value);
export const accuracyValues = (value: unknown, url: boolean) => new Set(
  (Array.isArray(value) ? value : [value]).filter(v => v != null).map(v => normalized(url ? canonicalUrl(String(v)) : v)),
);
export function expectedAccuracyFields(item: AccuracyCase): Record<string, unknown> {
  // The original flattened links target contains project destinations. Project
  // and certification ownership is scored separately without editing the truth.
  return {
    ...item.expectedFields,
    "links.url": item.expected.links.map(l => l.url),
    "projects.url": item.expected.projects.flatMap(p => p.url ? [p.url] : []),
    "certifications.url": item.expected.certifications.flatMap(c => c.url ? [c.url] : []),
  };
}
export function accuracyFor(item: AccuracyCase, parsed: StructuredExtraction, asOf: Date) {
  const expected = expectedAccuracyFields(item);
  const fields = Object.fromEntries(evaluationFields.map(field => {
    const target = expected[field as keyof typeof expected];
    const extracted = actualField(parsed, field);
    const e = accuracyValues(target, field.endsWith(".url")), a = accuracyValues(extracted, field.endsWith(".url"));
    const tp = [...a].filter(v => e.has(v)).length;
    return [field, { expected: target ?? null, actual: extracted ?? null, tp, fp: a.size - tp, fn: e.size - tp }];
  }));
  const expectedTuples = item.expected.employment.map(e => [e.employer, e.designation, e.startDate, e.endDate, e.isCurrent]);
  const date = (v: unknown) => {
    if (!v) return null;
    const d = v as { year?: number; month?: number };
    return d.year ? String(d.year) + (d.month ? "-" + String(d.month).padStart(2, "0") : "") : null;
  };
  const actualTuples = (parsed.candidate.employment?.upsert ?? []).map(e => [e.employer, e.designation, date(e.startDate), date(e.endDate), Boolean(e.isCurrent)]);
  const tupleKey = (t: unknown[]) => JSON.stringify(t.map(v => v == null ? null : normalized(v)));
  const remaining = actualTuples.map(tupleKey);
  let tupleHits = 0;
  for (const tuple of expectedTuples) {
    const index = remaining.indexOf(tupleKey(tuple));
    if (index >= 0) { tupleHits++; remaining.splice(index, 1); }
  }
  const conventionTarget = experienceMonths(item.expected.employment.map(e => ({
    startDate: e.startDate ? { year: Number(e.startDate.slice(0, 4)), month: Number(e.startDate.slice(5, 7)) } : null,
    endDate: e.endDate ? { year: Number(e.endDate.slice(0, 4)), month: Number(e.endDate.slice(5, 7)) } : null,
    isCurrent: e.isCurrent,
  })), asOf);
  const total = parsed.candidate.profile?.totalExperienceMonths ?? null;
  const benchmark = item.expectedFields["profile.totalExperienceMonths"];
  const review = reviewDecision(parsed.basic, {
    locationText: parsed.candidate.profile?.locationText ?? null,
    summary: parsed.candidate.profile?.summary ?? null,
    skills: (parsed.candidate.skills?.upsert ?? []).map(s => ({ skill: { canonicalName: s.name } })),
    links: (parsed.candidate.links?.upsert ?? []).map(l => ({ url: l.url ?? "" })),
  });
  return {
    id: item.id, fields,
    employmentTuples: { expected: expectedTuples.length, actual: actualTuples.length, exact: tupleHits, missing: expectedTuples.length - tupleHits, extra: remaining.length },
    experience: { actual: total, conventionTarget, conventionExact: total === conventionTarget, benchmark, benchmarkDelta: typeof benchmark === "number" && total != null ? total - benchmark : null },
    automaticCompletion: review.requiresReview ? "REVIEW" : review.threshold === 0.75 ? "LAYER_1" : "LAYER_2",
    confidence: parsed.basic.overallConfidence, review, warnings: parsed.warnings,
  };
}
