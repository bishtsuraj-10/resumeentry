import type { SourceLine } from "./text-normalizer";
import { skillDictionary } from "./dictionaries/skills";
export type Section =
  | "header"
  | "summary"
  | "objective"
  | "skills"
  | "employment"
  | "education"
  | "projects"
  | "certifications"
  | "languages"
  | "awards"
  | "publications"
  | "volunteering"
  | "internships"
  | "qualifications"
  | "personal"
  | "references"
  | "unknown";
export interface SectionLine extends SourceLine {
  section: Section;
}
export const headings: Record<
  Exclude<Section, "header" | "unknown">,
  string[]
> = {
  summary: [
    "summary",
    "professional summary",
    "profile",
    "professional profile",
    "about me",
  ],
  objective: ["objective", "career objective"],
  skills: [
    "skills",
    "technical skills",
    "core competencies",
    "core skills",
    "toolkit",
    "key skills",
    "expertise",
    "skills and competencies",
  ],
  employment: [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "work history",
    "career history",
  ],
  education: [
    "education",
    "academic qualifications",
    "academic background",
    "educational qualifications",
    "learning",
  ],
  projects: [
    "projects",
    "key projects",
    "academic projects",
    "professional projects",
    "personal projects",
    "selected work",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licenses and certifications",
    "credentials",
    "professional registration",
  ],
  languages: ["languages", "language proficiency"],
  awards: ["awards", "achievements", "awards and achievements"],
  publications: ["publications", "research publications"],
  volunteering: [
    "volunteering",
    "volunteer experience",
    "community service",
    "professional contributions",
    "beyond the role",
  ],
  internships: ["internships", "internship experience"],
  qualifications: ["other qualifications", "additional qualifications"],
  personal: [
    "personal details",
    "personal information",
    "contact",
    "contact information",
    "profiles",
    "profile links",
    "professional links",
  ],
  references: ["references", "referees", "reference contacts"],
};
const lookup = new Map(
  Object.entries(headings).flatMap(([key, values]) =>
    values.map((v) => [v, key as Section] as const),
  ),
);
export function heading(value: string): {
  section: Section;
  content: string;
} | null {
  const cleaned = value.replace(/^[#*•\s]+|[\s:*#-]+$/g, "").trim();
  const colon = cleaned.indexOf(":");
  const label = (colon < 0 ? cleaned : cleaned.slice(0, colon))
    .replace(/\s+/g, " ")
    .toLowerCase();
  // Also recognize headings printed with spaces between letters.
  const compact = label.replace(/ /g, "");
  const section =
    lookup.get(label) ??
    (label.split(" ").every((v) => v.length === 1)
      ? [...lookup.entries()].find(
          ([v]) => v.replace(/ /g, "") === compact,
        )?.[1]
      : undefined);
  return section
    ? { section, content: colon < 0 ? "" : cleaned.slice(colon + 1).trim() }
    : null;
}
export function detectSections(lines: SourceLine[]): SectionLine[] {
  let current: Section = "header";
  const lanes = new Map<number, Section>();
  const result: SectionLine[] = [];
  for (const line of lines) {
    const cells = line.text.split(/\t+/);
    // Independent sections in aligned columns: remember each lane's heading.
    if (cells.length > 1 && cells.some((v) => heading(v))) {
      for (const [i, cell] of cells.entries()) {
        const h = heading(cell);
        if (h) lanes.set(i, h.section);
        const content = h?.content ?? cell;
        if (content)
          result.push({
            ...line,
            text: content,
            section: lanes.get(i) ?? current,
          });
      }
      continue;
    }
    if (lanes.size && cells.length > 1) {
      cells.forEach((cell, i) => {
        if (cell.trim())
          result.push({
            ...line,
            text: cell.trim(),
            section: lanes.get(i) ?? current,
          });
      });
      continue;
    }
    const h = heading(line.text);
    if (h) {
      current = h.section;
      lanes.clear();
      if (h.content)
        result.push({ ...line, text: h.content, section: current });
    } else if (
      /^[A-Z][A-Z &/]{2,40}:?$/.test(line.text) &&
      current !== "header" &&
      !/[|\t]/.test(line.text) &&
      !/^(?:MBA|MCA|BBA|BCA|MBBS|BDS|HSC|SSC|BS|MS|BA|GCSE)$/i.test(
        line.text,
      ) &&
      !(
        current === "skills" &&
        (/^\S{2,8}$/.test(line.text) || /[&+#.]/.test(line.text)) &&
        !/^(?:hobbies|interests|activities)$/i.test(line.text)
      ) &&
      !skillDictionary.some((s) =>
        [s.name, ...s.aliases].some(
          (v) => v.toLowerCase() === line.text.toLowerCase(),
        ),
      )
    ) {
      // An unknown heading is a boundary, not permission to spill into the prior section.
      current = "unknown";
      result.push({ ...line, section: current });
    } else
      result.push({
        ...line,
        // Preserve cell markers for table-aware record parsing.
        text: line.text.replace(/\t+/g, " | "),
        section: current,
      });
  }
  return result;
}
