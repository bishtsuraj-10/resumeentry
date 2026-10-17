import { skillDictionary } from "../dictionaries/skills";
import { evidence, type MachineEvidence } from "../field-confidence";
import type { SectionLine } from "../section-detector";
import { contaminatedSkill, industrialAws } from "../suspicious";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const competencyBullet = /^[-•*●▪\uF076\uF0B7]\s*/;
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
  const warnings: string[] = [];
  const explicit = lines.filter(
    (l) =>
      l.section === "skills" ||
      (l.section === "projects" &&
        /^(?:technolog(?:y|ies)|methods\s*\/\s*tools|tools|skills)\s*:/i.test(
          l.text,
        )),
  );
  const groups: (SectionLine & { lastLine: number })[] = [];
  const coveredCompetencies = new Set<string>();
  for (const line of explicit) {
    const previous = groups[groups.length - 1];
    if (line.skillFormat === "competency" && previous?.skillFormat === "competency" &&
      previous.page === line.page && line.line === previous.lastLine + 1 &&
      competencyBullet.test(previous.text) && !competencyBullet.test(line.text)) {
      previous.text += " " + line.text;
      previous.lastLine = line.line;
    } else groups.push({ ...line, lastLine: line.line });
  }
  for (const line of groups)
    for (const raw of (line.skillFormat === "competency" && competencyBullet.test(line.text) ? [line.text] : line.text
      .replace(
        /^(?:technolog(?:y|ies)|methods\s*\/\s*tools|tools|skills)\s*:\s*/i,
        "",
      )
      // A spaced list slash can touch a PDF line boundary. Preserve compact
      // terms such as CI/CD while excluding the orphan delimiter from skills.
      .split(/[,;|]|\s+\/(?:\s+|$)|^\/\s+/))) {
      const value = raw.replace(line.skillFormat === "competency" ? competencyBullet : /^\s*[-•*]\s*/, "").trim();
      if (contaminatedSkill(value)) {
        warnings.push("SKILL_CONTAMINATION");
        proofs.push(
          evidence("observed.skills", line, ["SKILL_CONTAMINATION"], 0),
        );
        continue;
      }
      if (
        /\b(?:responsible for|worked on|project description|address\s*:)\b/i.test(
          value,
        )
      )
        warnings.push("SKILL_CONTAMINATION");
      const welding = industrialAws(line.text);
      if (welding) warnings.push("AMBIGUOUS_AWS_CONTEXT");
      if (welding && /^AWS$/i.test(value)) {
        proofs.push(
          evidence("observed.skills", line, ["AMBIGUOUS_AWS_CONTEXT"], 0),
        );
        continue;
      }
      if (
        !value ||
        value.length > 120 ||
        value.split(/\s+/).length > (line.skillFormat === "competency" ? 20 : 8) ||
        /[!?]|\.$/.test(value)
      )
        continue;
      const known =
        welding && /^AWS\b/i.test(value)
          ? undefined
          : skillDictionary.find((s) =>
              [s.name, ...s.aliases].some(
                (v) => v.toLowerCase() === value.toLowerCase(),
              ),
            );
      const name = known?.name ?? value;
      if (line.skillFormat === "competency" && competencyBullet.test(line.text))
        for (let ordinal = line.line; ordinal <= line.lastLine; ordinal++) coveredCompetencies.add(`${line.page}:${ordinal}`);
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
    // One accepted competency bullet is one source-supported skill; avoid
    // appending redundant dictionary fragments of that same statement.
    if (line.skillFormat === "competency" && coveredCompetencies.has(`${line.page}:${line.line}`)) continue;
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
        if (match[0].toUpperCase() === "AWS" && industrialAws(line.text)) {
          warnings.push("AMBIGUOUS_AWS_CONTEXT");
          proofs.push(
            evidence("observed.skills", line, ["AMBIGUOUS_AWS_CONTEXT"], 0),
          );
          continue;
        }
        // CRM also denotes cold rolling mills in industrial resumes.
        if (
          match[0].toUpperCase() === "CRM" &&
          /\b(?:mills?|rolling|steel)\b/i.test(line.text) &&
          !/\b(?:customer|sales|relationship)\b/i.test(line.text)
        )
          continue;
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
    warnings: [
      ...new Set([
        ...warnings,
        ...(explicit.some(
          (l) =>
            /\|/.test(l.text) &&
            /\b(?:and|with|using|of|to)\b|\w-\s*\|/i.test(l.text),
        )
          ? ["AMBIGUOUS_SKILL_LAYOUT"]
          : []),
      ]),
    ],
  };
}
