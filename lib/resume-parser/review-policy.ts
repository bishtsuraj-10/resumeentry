import type { ResumeExtraction } from "./basic";
// Layout/OCR diagnostics remain visible in provenance. They alone do not
// invalidate an otherwise complete, high-confidence candidate identity.
const informational = new Set([
  "LAYOUT_READING_ORDER_UNCERTAIN",
  "ROTATED_TEXT_LAYOUT",
  "DOCX_LAYOUT_WARNINGS",
]);
export function reviewDecision(
  basic: ResumeExtraction,
  warnings: string[],
  configured = process.env.CONFIDENCE_THRESHOLD ?? "75",
) {
  const value = Number(configured),
    threshold =
      Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : 0.75;
  const reasons = warnings.filter((w) => !informational.has(w));
  if (basic.overallConfidence < threshold)
    reasons.push("BELOW_CONFIDENCE_THRESHOLD");
  for (const field of ["name", "email", "phone", "designation"] as const)
    if (!basic[field]) reasons.push("MISSING_" + field.toUpperCase());
  return {
    requiresReview: reasons.length > 0,
    reasons: [...new Set(reasons)],
    informationalWarnings: warnings.filter((w) => informational.has(w)),
    threshold,
  };
}
