import { extractStructuredResume, type StructuredExtraction } from "./index";
export const evaluationFields = [
  "basic.name",
  "basic.email",
  "basic.otherEmails",
  "basic.normalizedPhone",
  "basic.designation",
  "profile.firstName",
  "profile.lastName",
  "profile.headline",
  "profile.summary",
  "profile.objective",
  "profile.locationText",
  "profile.city",
  "profile.region",
  "profile.country",
  "profile.dateOfBirth",
  "profile.noticePeriod",
  "profile.employmentPreferences",
  "profile.totalExperienceMonths",
  "profile.additionalPhones",
  "skills",
  "employment.employer",
  "employment.designation",
  "employment.startDate",
  "employment.endDate",
  "education.degree",
  "education.institution",
  "education.fieldOfStudy",
  "education.endDate",
  "education.grade",
  "education.gradeScale",
  "projects.name",
  "projects.role",
  "projects.skills",
  "certifications.name",
  "certifications.issuer",
  "certifications.issueDate",
  "links.url",
  "additional.title",
];
function partialDate(value: unknown): unknown {
  if (value == null) return null;
  const d = value as {
    year?: number;
    month?: number;
    day?: number;
    text?: string;
  };
  return d.year
    ? String(d.year) +
        (d.month ? "-" + String(d.month).padStart(2, "0") : "") +
        (d.day ? "-" + String(d.day).padStart(2, "0") : "")
    : d.text;
}
export function actualField(
  result: StructuredExtraction,
  path: string,
): unknown {
  if (path.startsWith("basic."))
    return result.basic[path.slice(6) as keyof typeof result.basic];
  if (path === "profile.additionalPhones")
    return result.candidate.profile?.additionalPhones?.map(
      (p) => p.normalizedPhone,
    );
  if (path.startsWith("profile."))
    return result.candidate.profile?.[
      path.slice(8) as keyof NonNullable<typeof result.candidate.profile>
    ];
  if (path === "skills")
    return result.candidate.skills?.upsert?.map((s) => s.name);
  const [section, field] = path.split(".");
  if (path === "projects.skills")
    return result.candidate.projects?.upsert?.flatMap(
      (p) => p.skills?.map((s) => s.name) ?? [],
    );
  const set =
    result.candidate[
      section as
        | "employment"
        | "education"
        | "projects"
        | "certifications"
        | "links"
        | "additional"
    ];
  return set?.upsert
    ?.map((s) => {
      const v = (s as Record<string, unknown>)[field];
      return field.endsWith("Date") ? partialDate(v) : v;
    })
    .filter((v) => v != null);
}
function values(value: unknown): Set<string> {
  return new Set(
    (Array.isArray(value) ? value : [value])
      .filter((v) => v != null)
      .map((v) => String(v).normalize("NFKC").toLowerCase().trim()),
  );
}
export function evaluateCorpus(
  cases: {
    id: string;
    text: string;
    expected: Record<string, unknown>;
  }[],
) {
  const counts = Object.fromEntries(
    evaluationFields.map((field) => [
      field,
      { tp: 0, fp: 0, fn: 0, missingFields: 0 },
    ]),
  );
  const documents = cases.map((item) => {
    const result = extractStructuredResume(item.text, {
      asOf: new Date("2026-10-01T00:00:00Z"),
    });
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const field of evaluationFields) {
      const expected = values(item.expected[field]),
        actual = values(actualField(result, field)),
        count = counts[field];
      const hits = [...actual].filter((v) => expected.has(v)).length,
        extras = actual.size - hits,
        misses = expected.size - hits;
      count.tp += hits;
      count.fp += extras;
      count.fn += misses;
      if (expected.size && !actual.size) count.missingFields++;
      tp += hits;
      fp += extras;
      fn += misses;
    }
    return {
      id: item.id,
      tp,
      fp,
      fn,
      success: Boolean(result.basic.name && result.basic.email),
      durationMs: result.durationMs,
      warnings: result.warnings,
    };
  });
  const metric = (c: { tp: number; fp: number; fn: number }) => ({
    precision: c.tp + c.fp ? c.tp / (c.tp + c.fp) : null,
    recall: c.tp + c.fn ? c.tp / (c.tp + c.fn) : null,
    f1: 2 * c.tp + c.fp + c.fn ? (2 * c.tp) / (2 * c.tp + c.fp + c.fn) : null,
  });
  const totals = Object.values(counts).reduce(
    (a, b) => ({
      tp: a.tp + b.tp,
      fp: a.fp + b.fp,
      fn: a.fn + b.fn,
      missingFields: a.missingFields + b.missingFields,
    }),
    { tp: 0, fp: 0, fn: 0, missingFields: 0 },
  );
  return {
    documents,
    documentSuccess: documents.filter((d) => d.success).length,
    documentCount: cases.length,
    fields: Object.fromEntries(
      Object.entries(counts).map(([field, c]) => [
        field,
        { ...c, ...metric(c) },
      ]),
    ),
    totals: { ...totals, ...metric(totals) },
  };
}
