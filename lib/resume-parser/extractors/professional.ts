import type { SectionLine } from "../section-detector";
import { extractResumeFields } from "../basic";
import { evidence, type MachineEvidence } from "../field-confidence";
export function extractProfessional(lines: SectionLine[]) {
  const profile: Record<string, unknown> = {};
  const proofs: MachineEvidence[] = [];
  for (const [section, key] of [
    ["summary", "summary"],
    ["objective", "objective"],
  ]) {
    const source = lines.filter((l) => l.section === section);
    if (source.length) {
      profile[key] = source
        .map((l) => l.text)
        .join("\n")
        .slice(0, key === "summary" ? 20000 : 10000);
      proofs.push(
        ...source
          .slice(0, 20)
          .map((l) =>
            evidence("profile." + key, l, ["EXPLICIT_SECTION"], 0.93),
          ),
      );
    }
  }
  const safe = lines.filter((l) =>
    ["header", "summary", "employment"].includes(l.section),
  );
  const designation = extractResumeFields(safe.map((l) => l.text).join("\n"));
  const headerTitle = lines.find(
    (l) => l.section === "header" && extractResumeFields(l.text).designation,
  );
  if (headerTitle) {
    profile.headline = headerTitle.text.slice(0, 500);
    proofs.push(
      evidence("profile.headline", headerTitle, ["HEADER_TITLE"], 0.88),
    );
  }
  if (designation.designation) {
    const line = safe.find((l) =>
      l.text.toLowerCase().includes(designation.designation!.toLowerCase()),
    );
    if (line)
      proofs.push(
        evidence(
          "basic.designation",
          line,
          ["TITLE_DICTIONARY", "EMPLOYMENT_OR_HEADER"],
          designation.designationConfidence,
        ),
      );
  }
  for (const line of lines.filter(
    (l) => !["references", "unknown", "education"].includes(l.section),
  )) {
    const notice = line.text.match(/^notice period\s*:\s*(.+)$/i);
    if (notice) {
      profile.noticePeriod = notice[1].slice(0, 200);
      proofs.push(
        evidence("profile.noticePeriod", line, ["EXPLICIT_LABEL"], 0.96),
      );
    }
    const preference = line.text.match(
      /^(?:employment preferences?|work preference|preferred employment)\s*:\s*(.+)$/i,
    );
    if (preference) {
      profile.employmentPreferences = preference[1]
        .split(/[,;]/)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 20);
      proofs.push(
        evidence(
          "profile.employmentPreferences",
          line,
          ["EXPLICIT_LABEL"],
          0.96,
        ),
      );
    }
    const duration =
      line.text.match(
        /(?:total experience\s*:\s*|(?:over |about |approximately )?)(\d+(?:\.\d+)?)\s*years?(?:\s+(?:and\s+)?(\d+)\s*months?)?\s+(?:of\s+)?(?:professional |work |total )?experience/i,
      ) ??
      line.text.match(
        /^total experience\s*:\s*(\d+(?:\.\d+)?)\s*years?(?:\s+(\d+)\s*months?)?/i,
      );
    if (
      duration &&
      !/\b(over|about|approximately|at least)\b|\d\s*\+/.test(
        line.text.toLowerCase(),
      )
    ) {
      const months = Math.round(+duration[1] * 12) + +(duration[2] ?? 0);
      if (months <= 1200) {
        profile.totalExperienceMonths = months;
        proofs.push(
          evidence(
            "profile.totalExperienceMonths",
            line,
            ["EXPLICIT_DURATION"],
            0.9,
          ),
        );
      }
    }
  }
  return {
    profile,
    designation: designation.designation,
    designationConfidence: designation.designationConfidence,
    evidence: proofs,
  };
}
