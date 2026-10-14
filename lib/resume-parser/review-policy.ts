import { candidatePatchSchema, safeUrlSchema } from "../candidate-validation";

type SavedExtraction = {
  name: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  overallConfidence: number;
};
type SavedCandidate = {
  locationText: string | null;
  summary: string | null;
  skills: { skill: { canonicalName: string } }[];
  links: { url: string }[];
};

// Avoid token counts or Western name/title patterns that reject legitimate text.
export function meaningfulReviewText(value: string | null | undefined) {
  if (!value) return false;
  const normalized = value.normalize("NFKC").trim();
  return (
    /\p{L}/u.test(normalized) &&
    !/^(?:n\s*\/\s*a|na|none|null|unknown|not[\s_-]+(?:provided|available|applicable|specified)|unavailable|missing|tbd)[.!]?$/i.test(normalized)
  );
}

// Supply saved extraction/profile relations after persistence. Parser diagnostics
// remain provenance rather than additional automatic completion gates.
export function reviewDecision(
  basic: SavedExtraction,
  candidate: SavedCandidate | null,
) {
  const reasons: string[] = [];
  const basicSchema = candidatePatchSchema.shape.basic.unwrap().shape;
  for (const field of ["name", "email", "phone", "designation"] as const) {
    const present = field === "phone"
      ? Boolean(basic.phone?.trim())
      : meaningfulReviewText(basic[field]);
    if (!present || !basicSchema[field].safeParse(basic[field]).success)
      reasons.push("MISSING_" + field.toUpperCase());
  }
  if (!meaningfulReviewText(candidate?.locationText))
    reasons.push("MISSING_LOCATION");
  if (!candidate?.skills.some((entry) => meaningfulReviewText(entry.skill.canonicalName)))
    reasons.push("MISSING_SKILLS");
  if (!meaningfulReviewText(candidate?.summary)) reasons.push("MISSING_SUMMARY");
  const links = candidate?.links ?? [];
  const hasLink = links.some((entry) => safeUrlSchema.safeParse(entry.url).success);
  if (!hasLink) reasons.push("MISSING_LINKS");
  // Layer 2 permits absent links, not a supplied but unusable link collection.
  if (!hasLink && links.length) reasons.push("INVALID_LINKS");
  const threshold = hasLink ? 0.75 : 0.85;
  if (
    !Number.isFinite(basic.overallConfidence) ||
    basic.overallConfidence < threshold ||
    basic.overallConfidence > 1
  )
    reasons.push("BELOW_CONFIDENCE_THRESHOLD");
  return {
    requiresReview: reasons.some((reason) => reason !== "MISSING_LINKS"),
    reasons,
    threshold,
  };
}
