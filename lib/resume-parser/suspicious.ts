import type { StructuredExtraction } from "./index";
import type { NuTarget } from "./ollama-nuextract";

export const resumeHeading = (value: string) =>
  /^(?:curricul[au]m\s+vitae|resume|résumé|bio[ -]?data|professional\s+(?:profile|summary))\s*[:.]?$/i.test(
    value.trim(),
  );
export const contaminatedSkill = (value: string) =>
  /^(?:(?:19|20)\d{2}(?:\s*[-–/]\s*(?:(?:19|20)\d{2}|present))?|(?:permanent|present|postal|residential)?\s*address\s*:.*|(?:education|employment|project descriptions?|personal details|academic qualifications|professional experience)\s*:?)$/i.test(
    value.trim(),
  );
export const industrialAws = (value: string) =>
  /\bAWS\b/i.test(value) &&
  /\b(?:weld\w*|shipbuild\w*|D1[. -]1|D1[. -]6|structural steel)\b/i.test(
    value,
  ) &&
  !/\b(?:amazon|cloud|EC2|S3)\b/i.test(value);

// Ambiguity adds review gates; it never authorizes overwriting an existing value.
export function suspiciousTargets(result: StructuredExtraction): NuTarget[] {
  const targets = new Set<NuTarget>();
  if (result.basic.name && resumeHeading(result.basic.name))
    targets.add("identity");
  if (/\b(?:19|20)\d{2}\b/.test(result.basic.designation ?? ""))
    targets.add("professional");
  if (
    result.candidate.skills?.upsert?.some(
      (s) =>
        contaminatedSkill(s.name) ||
        /\b(?:responsible for|worked on|project description|address\s*:)\b/i.test(
          s.name,
        ),
    )
  )
    targets.add("skillsLinks");
  if (
    result.candidate.education?.upsert?.some(
      (e) =>
        /^MS$/i.test(e.degree ?? "") &&
        /\b(?:office|projects?|excel|word)\b/i.test(e.institution ?? ""),
    )
  )
    targets.add("education");
  if (
    result.candidate.employment?.upsert?.some((e) =>
      /^(?:client|project)\s*:/i.test(e.employer ?? ""),
    )
  )
    targets.add("employment");
  for (const warning of result.warnings) {
    if (/EMPLOYER_CLIENT|PROJECT_AS_EMPLOYMENT/.test(warning))
      targets.add("employment");
    if (/SKILL_CONTAMINATION|AWS_CONTEXT/.test(warning))
      targets.add("skillsLinks");
    if (/SUMMARY_OWNERSHIP/.test(warning)) targets.add("professional");
  }
  return [...targets];
}
