import {
  candidatePatchSchema,
  type CandidatePatch,
} from "../candidate-validation";
import { normalizeText, assessTextQuality } from "./text-normalizer";
import { detectSections } from "./section-detector";
import { extractIdentityContact } from "./extractors/identity-contact";
import { extractProfessional } from "./extractors/professional";
import { extractSkills } from "./extractors/skills";
import { extractRecords } from "./extractors/records";
import { extractLinks } from "./extractors/profile-links";
import { experienceMonths } from "./validators/dates";
import { evidence, type MachineEvidence } from "./field-confidence";
import type { ResumeExtraction } from "./basic";
export const PARSER_VERSION = "local-comprehensive-v1.1";
export interface StructuredExtraction {
  basic: ResumeExtraction;
  candidate: Omit<CandidatePatch, "expectedRevision">;
  evidence: MachineEvidence[];
  warnings: string[];
  durationMs: number;
  parserVersion: string;
}
export function extractStructuredResume(
  text: string,
  options: {
    asOf?: Date;
    documentWarnings?: string[];
  } = {},
): StructuredExtraction {
  const started = performance.now();
  if (text.length > 200000) throw new Error("Text exceeds extraction limit");
  const lines = detectSections(normalizeText(text));
  const identity = extractIdentityContact(lines),
    professional = extractProfessional(lines),
    skills = extractSkills(lines),
    records = extractRecords(lines),
    links = extractLinks(lines);
  const profile = { ...identity.profile, ...professional.profile };
  const proofs = [
    ...identity.evidence,
    ...professional.evidence,
    ...skills.evidence,
    ...records.evidence,
    ...links.evidence,
  ];
  if (profile.totalExperienceMonths == null) {
    const months = records.warnings.some((w) =>
      ["UNRESOLVED_EMPLOYMENT", "UNCERTAIN_EMPLOYER"].includes(w),
    )
      ? null
      : experienceMonths(records.employment, options.asOf ?? new Date());
    const source = lines.filter(
      (l) => l.section === "employment" || l.section === "internships",
    );
    if (months !== null && months <= 1200 && source.length) {
      profile.totalExperienceMonths = months;
      proofs.push(
        ...source
          .filter((l) => /\d{4}/.test(l.text))
          .slice(0, 100)
          .map((line) =>
            evidence(
              "profile.totalExperienceMonths",
              line,
              ["MONTH_PRECISION", "UNION_OF_EMPLOYMENT_INTERVALS"],
              0.78,
            ),
          ),
      );
    }
  }
  const basic = {
    ...identity.basic,
    designation: professional.designation,
    designationConfidence: professional.designationConfidence,
  };
  basic.overallConfidence =
    (basic.nameConfidence +
      basic.emailConfidence +
      basic.phoneConfidence +
      basic.designationConfidence) /
    4;
  const raw: Record<string, unknown> = { expectedRevision: 0 };
  const warnings = [
    ...assessTextQuality(text).warnings,
    ...(options.documentWarnings ?? []),
    ...records.warnings,
  ];
  if (
    identity.evidence.some((e) =>
      e.signals.includes("UNRESOLVED_PHONE_COUNTRY"),
    )
  )
    warnings.push("UNRESOLVED_PHONE_COUNTRY");
  if (Object.keys(profile).length) {
    if (
      candidatePatchSchema.safeParse({ expectedRevision: 0, profile }).success
    )
      raw.profile = profile;
    else warnings.push("INVALID_PROFILE_FIELDS");
  }
  let operations = 0,
    terms = 0;
  const evidencePaths = new Map<string, string>();
  for (const [section, items] of Object.entries({
    skills: skills.items,
    employment: records.employment,
    education: records.education,
    projects: records.projects,
    certifications: records.certifications,
    links: links.items,
    additional: records.additional,
  })) {
    const selected: unknown[] = [];
    for (const [index, item] of items.entries()) {
      const record = item as Record<string, unknown>;
      const references =
        section === "skills"
          ? [record]
          : section === "projects"
            ? ((record.skills ?? []) as Record<string, unknown>[])
            : [];
      const cost = references.reduce(
        (n, r) => n + 1 + ((r.aliases ?? []) as string[]).length,
        0,
      );
      if (operations >= 100 || terms + cost > 200) {
        warnings.push("STRUCTURED_OUTPUT_TRUNCATED");
        continue;
      }
      if (
        !candidatePatchSchema.safeParse({
          expectedRevision: 0,
          [section]: { upsert: [item] },
        }).success
      ) {
        warnings.push("INVALID_" + section.toUpperCase() + "_ENTRY");
        continue;
      }
      evidencePaths.set(`${section}.${index}`, `${section}.${selected.length}`);
      selected.push(item);
      operations++;
      terms += cost;
    }
    if (selected.length) raw[section] = { upsert: selected };
  }
  // Validate machine output through the same safe data contract, excluding user-only revisions/confidence.
  let candidate: StructuredExtraction["candidate"] = {};
  if (Object.keys(raw).length > 1) {
    const validated = candidatePatchSchema.safeParse(raw);
    if (validated.success) {
      const { expectedRevision: _revision, ...value } = validated.data;
      void _revision;
      candidate = value;
    } else warnings.push("STRUCTURED_VALIDATION_FAILED");
  }
  if (!basic.name) warnings.push("MISSING_CANDIDATE_NAME");
  const finalProofs = proofs.map((proof) => {
    const prefix = proof.fieldPath.match(
      /^(skills|employment|education|projects|certifications|links|additional)\.\d+/,
    )?.[0];
    const path = prefix ? evidencePaths.get(prefix) : undefined;
    const fieldPath = prefix
      ? path
        ? path + proof.fieldPath.slice(prefix.length)
        : "observed." + proof.fieldPath
      : proof.fieldPath.startsWith("profile.") && !candidate.profile
        ? "observed." + proof.fieldPath
        : proof.fieldPath;
    return { ...proof, fieldPath };
  });
  return {
    basic,
    candidate,
    evidence: finalProofs.slice(0, 1500),
    warnings: [...new Set(warnings)],
    durationMs: performance.now() - started,
    parserVersion: PARSER_VERSION,
  };
}
