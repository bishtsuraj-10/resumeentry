import type { SourceLine } from "./text-normalizer";
import { skillDictionary } from "./dictionaries/skills";
import { stackedEmploymentHeader } from "./employment-header";
import { jobTitle } from "./basic";
import { dateRange } from "./validators/dates";
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
  skillFormat?: "competency";
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
    "executive profile",
    "synopsis",
    "professional synopsis",
    "professional overview",
  ],
  objective: ["objective", "career objective"],
  skills: [
    "core strengths",
    "key strengths",
    "professional strengths",
    "skills",
    "technical skills",
    "core competencies",
    "core skills",
    "toolkit",
    "key skills",
    "expertise",
    "skills and competencies",
    "software",
    "productive tools",
  ],
  employment: [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "work history",
    "career history",
    "employment chronology",
    "career timeline",
    "career profile",
    "carrier profile",
  ],
  education: [
    "education",
    "academic qualifications",
    "academic qualification",
    "academic credentials",
    "academic background",
    "educational qualifications",
    "educational qualification",
    "technical education",
    "learning",
  ],
  projects: [
    "projects",
    "key projects",
    "academic projects",
    "academic project",
    "final year project",
    "final-year project",
    "final year projects",
    "final-year projects",
    "capstone project",
    "capstone projects",
    "professional projects",
    "personal projects",
    "selected work",
    "work experience- summary",
    "work experience - summary",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licenses and certifications",
    "certifications and licenses",
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
    "other personal details",
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
    .replace(/&/g, " and ")
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
  let ownedEmployment = false;
  let skillFormat: "competency" | undefined;
  const lanes = new Map<number, Section>();
  const competencyLanes = new Set<number>();
  const result: SectionLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.columnStart) {
      current = "header";
      ownedEmployment = false;
      lanes.clear();
      competencyLanes.clear();
    }
    if (/^I declare\b/i.test(line.text)) current = "unknown";
    const inline = heading(line.text);
    if (current === "employment") {
      const previous = lines[index - 1];
      const cells = line.text.split(/[|\t]/).map(v => v.trim());
      const rowTitle = jobTitle(cells[0]);
      if ((previous && previous.page === line.page && line.line === previous.line + 1 &&
        stackedEmploymentHeader(previous.text, line.text)) ||
        (cells.length >= 3 && rowTitle && cells[0].toLowerCase().startsWith(rowTitle.toLowerCase()) && dateRange(line.text) &&
          !dateRange(cells[1]) && !/^(?:project|client)\s*:/i.test(cells[1]))) ownedEmployment = true;
    }
    if (current === "employment" && ownedEmployment && inline?.section === "projects" && inline.content) {
      // Keep inline project summaries with their employer. Standalone section
      // headings still end employment, including a standalone Projects heading.
      result.push({ ...line, text: line.text.replace(/\t+/g, " | "), section: current });
      continue;
    }
    const cells = line.text.split(/\t+/);
    // Independent sections in aligned columns: remember each lane's heading.
    if (cells.length > 1 && cells.some((v) => heading(v))) {
      for (const [i, cell] of cells.entries()) {
        const h = heading(cell);
        if (h) {
          lanes.set(i, h.section);
          if (h.section === "skills" && /^(?:core|key|professional) strengths\b/i.test(cell)) competencyLanes.add(i);
          else competencyLanes.delete(i);
        }
        const content = h?.content ?? cell;
        if (content)
          result.push({
            ...line,
            text: content,
            section: lanes.get(i) ?? current,
            ...(competencyLanes.has(i) ? { skillFormat: "competency" as const } : {}),
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
            ...(competencyLanes.has(i) ? { skillFormat: "competency" as const } : {}),
          });
      });
      continue;
    }
    const h = heading(line.text);
    if (h) {
      current = h.section;
      ownedEmployment = false;
      skillFormat = h.section === "skills" && /^(?:core|key|professional) strengths\b/i.test(line.text) ? "competency" : undefined;
      lanes.clear();
      competencyLanes.clear();
      if (h.content)
        result.push({ ...line, text: h.content, section: current, ...(skillFormat ? { skillFormat } : {}) });
    } else if (
      /^[A-Z][A-Z &/]{2,40}:?$/.test(line.text) &&
      current !== "header" &&
      !/[|\t]/.test(line.text) &&
      !/^(?:MBA|MCA|BBA|BCA|MBBS|BDS|HSC|SSC|BS|MS|BA|GCSE)$/i.test(
        line.text,
      ) &&
      !(
        current === "skills" && !skillFormat &&
        (/^\S{2,8}$/.test(line.text) || /^(?:auto cad|ms office)$/i.test(line.text) || /[&+#.]/.test(line.text)) &&
        !/^(?:hobbies|interests|activities)$/i.test(line.text)
      ) &&
      !skillDictionary.some((s) =>
        [s.name, ...s.aliases].some(
          (v) => v.toLowerCase() === line.text.toLowerCase(),
        ),
      ) &&
      !(current === "employment" && lines[index + 1]?.page === line.page &&
        stackedEmploymentHeader(line.text, lines[index + 1].text))
    ) {
      // An unknown heading is a boundary, not permission to spill into the prior section.
      current = "unknown";
      result.push({ ...line, section: current });
    } else
      result.push({
        ...line,
        // Preserve cell markers for table-aware record parsing.
        text: current === "employment"
          ? line.text.replace(/^[-•*]\s*/, "").replace(/\s+I\s+/g, " | ").replace(/,\s*(?=[A-Za-z]+\s+\d{4}\s*(?:to|-))/, " | ").replace(/\t+/g, " | ")
          : line.text.replace(/\t+/g, " | "),
        section: current,
        ...(current === "skills" && skillFormat ? { skillFormat } : {}),
      });
  }
  return result;
}
