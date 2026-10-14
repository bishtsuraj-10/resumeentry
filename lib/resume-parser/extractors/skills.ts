import { skillDictionary } from "../dictionaries/skills";
import { evidence, type MachineEvidence } from "../field-confidence";
import type { SectionLine } from "../section-detector";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = skillDictionary.map((skill) => ({
  skill,
  regex: new RegExp(
    `(?<![\\p{L}\\p{N}_])(${[skill.name, ...skill.aliases]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join("|")})(?![\\p{L}\\p{N}_+#])`,
    "giu",
  ),
}));
export function extractSkills(lines: SectionLine[]) {
  const skills = new Map<
    string,
    {
      name: string;
      aliases: string[];
      category: string;
      originalText: string;
      context: string;
    }
  >();
  const proofs: MachineEvidence[] = [];
  const explicit = lines.filter(
    (l) =>
      l.section === "skills" ||
      (l.section === "projects" &&
        /^(?:technolog(?:y|ies)|methods\s*\/\s*tools|tools|skills)\s*:/i.test(
          l.text,
        )),
  );
  const groups =
    explicit.some((l) => /[,;]|\s\/\s/.test(l.text)) &&
    explicit.every((l) => l.section === "skills")
      ? [{ ...explicit[0], text: explicit.map((l) => l.text).join(" ") }]
      : explicit;
  for (const line of groups)
    for (const raw of line.text
      .replace(
        /^(?:technolog(?:y|ies)|methods\s*\/\s*tools|tools|skills)\s*:\s*/i,
        "",
      )
      .split(/[,;|]|\s+\/\s+/)) {
      const value = raw.trim();
      if (
        !value ||
        value.length > 120 ||
        value.split(/\s+/).length > 8 ||
        /[!?]|\.$/.test(value)
      )
        continue;
      const known = skillDictionary.find((s) =>
        [s.name, ...s.aliases].some(
          (v) => v.toLowerCase() === value.toLowerCase(),
        ),
      );
      const name = known?.name ?? value;
      if (!skills.has(name))
        skills.set(name, {
          name,
          aliases: known?.aliases ?? [],
          category: known?.category ?? "Other",
          originalText: value,
          context: line.section,
        });
      const position = [...skills.keys()].indexOf(name);
      if (!known)
        proofs.push(
          evidence(
            `skills.${position}.name`,
            line,
            ["EXPLICIT_UNCATALOGUED_SKILL", "EXPLICIT_SKILL_SECTION"],
            0.9,
          ),
        );
    }
  for (const line of lines) {
    if (
      !["skills", "projects", "employment", "internships", "summary"].includes(
        line.section,
      )
    )
      continue;
    for (const { skill, regex } of patterns) {
      if (
        skill.ambiguous &&
        line.section !== "skills" &&
        !/\b(?:tools?|technolog(?:y|ies)|skills?|using|proficient)\b/i.test(
          line.text,
        )
      )
        continue;
      for (const match of line.text.matchAll(regex)) {
        // JS/TS/R abbreviations require explicit skills/tool context and original capitals.
        if (
          ["js", "ts", "r"].includes(match[0].toLowerCase()) &&
          (match[0] !== match[0].toUpperCase() ||
            !["skills", "projects"].includes(line.section))
        )
          continue;
        const index = skills.size;
        if (!skills.has(skill.name))
          skills.set(skill.name, {
            name: skill.name,
            aliases: skill.aliases,
            category: skill.category,
            originalText: match[0],
            context: line.section,
          });
        const position = [...skills.keys()].indexOf(skill.name);
        if (index <= 100)
          proofs.push(
            evidence(
              `skills.${position}.name`,
              line,
              [
                "DICTIONARY_BOUNDARY",
                line.section === "skills"
                  ? "EXPLICIT_SKILL_SECTION"
                  : "CONTEXTUAL_MENTION",
              ],
              line.section === "skills" ? 0.92 : 0.76,
            ),
          );
      }
    }
  }
  return {
    items: [...skills.values()].slice(0, 100),
    evidence: proofs.slice(0, 300),
  };
}
