import type { SectionLine } from "../section-detector";
import { jobTitle } from "../basic";
import { dateRange } from "../validators/dates";
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
  const titles = lines.flatMap((line, index) => {
    if (!["header", "summary", "employment"].includes(line.section)) return [];
    if (
      /^(?:client|reference|recruiter|desired|seeking|reporting to|as|worked as)\b|^project\s*(?:name|title)?\s*:/i.test(
        line.text,
      ) ||
      /\bchartered engineer\b/i.test(line.text)
    )
      return [];
    const firstTitle = jobTitle(line.text);
    const timelineTitle = line.section === "employment" && line.text.includes("|") &&
      !(firstTitle && line.text.toLowerCase().startsWith(firstTitle.toLowerCase()))
      ? line.text.split(/\s*\|\s*/)[1] : undefined;
    const title = jobTitle(timelineTitle ?? line.text);
    const owned = line.text.replace(
      /^(?:designation|job title|role)\s*:\s*/i,
      "",
    );
    // A dictionary mention in a responsibility is not the candidate's title.
    if (!title || !(timelineTitle ?? owned).toLowerCase().replace(/\s*-\s*/g, " - ").startsWith(title.toLowerCase()))
      return [];
    const next = lines[index + 1];
    const dates =
      dateRange(line.text) ??
      (next?.section === line.section ? dateRange(next.text) : null);
    if (
      line.section === "employment" &&
      !dates &&
      !/^(?:designation|job title|role)\s*:/i.test(line.text)
    )
      return [];
    const score =
      line.section === "employment" && dates?.isCurrent
        ? 10000
        : line.section === "header"
          ? 5000 - index
          : line.section === "employment" && dates?.endDate?.year
            ? dates.endDate.year
            : 0;
    return [{ line, title, score }];
  });
  let selected: (typeof titles)[number] | undefined = titles.sort(
    (a, b) => b.score - a.score,
  )[0];
  if (
    selected?.score < 10000 &&
    lines.some(
      (l) =>
        l.section === "employment" &&
        /\b(?:present|current|now|till date)\b/i.test(l.text),
    )
  )
    selected = undefined;
  // Keep an explicitly stated header specialty when it extends the current role.
  const specificHeader = titles.find((t) => t.line.section === "header" && selected &&
    t.title.toLowerCase().startsWith(selected.title.toLowerCase() + " - "));
  if (specificHeader) selected = specificHeader;
  const designation = {
    designation: selected?.title ?? null,
    designationConfidence: selected
      ? selected.score >= 1000
        ? 0.92
        : 0.66
      : 0,
  };
  const headerTitle = titles.find((t) => t.line.section === "header")?.line;
  if (headerTitle) {
    profile.headline = headerTitle.text.slice(0, 500);
    proofs.push(
      evidence("profile.headline", headerTitle, ["HEADER_TITLE"], 0.88),
    );
  }
  if (designation.designation) {
    const line = selected?.line;
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
      !/\b(over|about|approximately|at least|more than)\b|\d\s*\+/.test(
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
