import type { SectionLine, Section } from "../section-detector";
import { evidence, type MachineEvidence } from "../field-confidence";
import { dateRange, parseDate } from "../validators/dates";
import { extractResumeFields } from "../basic";
import { extractSkills } from "./skills";
import { safeUrlSchema } from "../../candidate-validation";
import { stackedEmploymentHeader } from "../employment-header";
type Entry = Record<string, unknown>;
const bullet = /^[-•*]\s*/;
const strip = (s: string) => s.replace(bullet, "").trim();
function labeled(lines: SectionLine[], pattern: string): string | undefined {
  for (const line of lines) {
    const m = line.text.match(
      new RegExp(`(?:^|\\s*\\|\\s*)(?:${pattern})\\s*:\\s*([^|]+)`, "i"),
    );
    if (m) return m[1].trim();
  }
}
function url(lines: SectionLine[]) {
  for (const line of lines)
    for (const v of line.text.match(/https?:\/\/[^\s<>]+/gi) ?? []) {
      const result = safeUrlSchema.safeParse(v.replace(/[),.;]+$/, ""));
      if (result.success) return result.data;
    }
}
function datedBlocks(lines: SectionLine[]): SectionLine[][] {
  const starts = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!dateRange(lines[i].text)) continue;
    let start = i;
    const range = dateRange(lines[i].text)!;
    if (i > 0 && lines[i - 1].page === lines[i].page &&
      lines[i].line === lines[i - 1].line + 1 &&
      stackedEmploymentHeader(lines[i - 1].text, lines[i].text)) {
      starts.add(i - 1);
      continue;
    }
    // Date-led rows often contain location/type cells; they still belong to
    // the preceding title/employer header. Only a row carrying identity cells
    // before its dates is self-contained.
    const selfContained = /\|/.test(lines[i].text) &&
      lines[i].text.slice(0, lines[i].text.indexOf(range.matched)).replace(bullet, "").trim().length > 0;
    if (
      !selfContained &&
      i > 0 &&
      !dateRange(lines[i - 1].text) &&
      !bullet.test(lines[i - 1].text) &&
      (/[|]|\bat\b|^(employer|company|designation):/i.test(lines[i - 1].text) ||
        extractResumeFields(lines[i - 1].text).designation)
    )
      start = i - 1;
    if (
      start === i &&
      !selfContained &&
      i > 1 &&
      !bullet.test(lines[i - 1].text) &&
      !dateRange(lines[i - 1].text) &&
      !dateRange(lines[i - 2].text) &&
      /[|]|\bat\b/i.test(lines[i - 2].text) &&
      !bullet.test(lines[i - 2].text)
    )
      start = i - 2;
    // Employer on one line, title on the next, followed by dates.
    if (
      !selfContained &&
      start > 0 &&
      /^(employer|company):/i.test(lines[start - 1].text)
    )
      start--;
    else if (
      !selfContained &&
      start > 0 &&
      !dateRange(lines[start - 1].text) &&
      lines[start - 1].text.length <= 160 &&
      !/^[\d•*-]/.test(lines[start - 1].text) &&
      /\b(?:limited|ltd|llc|inc|corporation|contracting|construction)\b/i.test(
        lines[start - 1].text,
      ) &&
      !extractResumeFields(lines[start - 1].text).designation
    )
      start--;
    starts.add(start);
  }
  const indices = [...starts].sort((a, b) => a - b);
  return indices.map((start, i) =>
    lines.slice(start, indices[i + 1] ?? lines.length),
  );
}
function namedBlocks(lines: SectionLine[], section: Section): SectionLine[][] {
  const blocks: SectionLine[][] = [];
  for (const [index, line] of lines.entries()) {
    const continuation =
      bullet.test(line.text) ||
      /^(description|role|technolog(?:y|ies)|tools|responsibilities|achievements|issuer|issued by|issuing organization|credential id|credential url|issue date|issued|expiry date|expiration date|expires|url|link|institution|university|field of study|grade|cgpa|gpa|location|dates?)\s*:/i.test(
        line.text,
      ) ||
      Boolean(dateRange(line.text)) ||
      Boolean(parseDate(line.text)) ||
      /^(?:credential|verify(?: credential| certificate)?|verification|website|url|link)\s*\(https?:\/\//i.test(
        line.text,
      ) ||
      /^https?:\/\//i.test(line.text);
    const issuerContinuation =
      section === "certifications" &&
      /^(?:issue date|issued)\s*:/i.test(lines[index + 1]?.text ?? "");
    const named =
      /^(project|certification|degree|qualification|name)\s*:/i.test(line.text);
    const degree = section === "education" && qualification(line.text) !== null;
    if (
      !blocks.length ||
      named ||
      degree ||
      (!continuation && !issuerContinuation && section === "certifications")
    )
      blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  return blocks;
}
function internshipHeader(text: string) {
  return strip(text).match(/^(.{1,90}\b(?:intern|trainee))\s+(?:-\s+|at\s+)(.{1,200})$/i);
}
function volunteerBlocks(lines: SectionLine[]): SectionLine[][] {
  const blocks: SectionLine[][] = [];
  for (const line of lines) {
    const title = strip(line.text).split(/\s+-\s+|\s*\|\s*/)[0];
    const roleHeader = /^(?:role|position)\s*:/i.test(title) ||
      (title.length <= 100 && /\s+-\s+|\|/.test(line.text) &&
        /\b(?:member|volunteer|mentor|coordinator|organizer|leader|president|secretary|treasurer)$/i.test(title)) ||
      /^(?:(?:student|community|senior|junior|lead|executive)\s+)?(?:member|volunteer|mentor|coordinator|organizer|leader)$/i.test(title);
    if (!blocks.length || roleHeader) blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  return blocks;
}
const qualifications = [
  "Bachelor of Architecture",
  "Master of Architecture",
  "B.Arch.",
  "M.Arch.",
  "Bachelor of Technology",
  "Bachelor of Engineering",
  "Bachelor of Science",
  "Bachelor of Commerce",
  "Bachelor of Arts",
  "Bachelor of Business Administration",
  "Master of Technology",
  "Master of Science",
  "Master of Arts",
  "Master of Commerce",
  "Master of Business Administration",
  "Master of Education",
  "Bachelor of Fine Arts",
  "Doctor of Pharmacy",
  "Associate of Applied Science",
  "Postgraduate Certificate",
  "PGPCM",
  "Doctor of Philosophy",
  "Associate Degree",
  "High School Diploma",
  "Diploma",
  "B.Tech",
  "B.E.",
  "B.Sc",
  "B.Com",
  "B.A.",
  "BBA",
  "BCA",
  "M.Tech",
  "M.Sc",
  "M.Com",
  "MBA",
  "MCA",
  "MBBS",
  "BDS",
  "PhD",
  "HSC",
  "SSC",
  "A Levels",
  "GCSE",
  "BS",
  "MS",
  "BA",
];
export function qualification(text: string) {
  for (const value of qualifications) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])${value === "MS" ? "(?!\\s+(?:Office|Projects?|Excel|Word|Windows)\\b)" : ""}`,
        "iu",
      ),
    );
    if (m) return m[0];
  }
  return null;
}
function proofs(
  prefix: string,
  entry: Entry,
  lines: SectionLine[],
  confidence: number,
): MachineEvidence[] {
  return Object.entries(entry)
    .filter(
      ([key, value]) =>
        !["position", "skills"].includes(key) &&
        value != null &&
        (!Array.isArray(value) || value.length),
    )
    .flatMap(([key, value]) => {
      const texts =
        typeof value === "string"
          ? [value]
          : Array.isArray(value)
            ? value.filter((v): v is string => typeof v === "string")
            : typeof value === "object" && value && "text" in value
              ? [String(value.text)]
              : [];
      const selected =
        key === "description"
          ? lines.slice(0, 20)
          : key === "isCurrent"
            ? lines.filter((l) => /\b(?:present|current|now)\b/i.test(l.text))
            : texts.length
              ? lines.filter((l) =>
                  texts.some((t) =>
                    l.text.toLowerCase().includes(t.toLowerCase()),
                  ),
                )
              : [];
      return (selected.length ? selected : lines.slice(0, 2)).map((l) =>
        evidence(
          `${prefix}.${key}`,
          l,
          ["EXPLICIT_SECTION", "RECORD_RULE"],
          confidence,
        ),
      );
    });
}
export function extractRecords(lines: SectionLine[]) {
  const employment: Entry[] = [],
    education: Entry[] = [],
    projects: Entry[] = [],
    certifications: Entry[] = [],
    additional: Entry[] = [];
  const allEvidence: MachineEvidence[] = [];
  const warnings: string[] = [];
  {
    const source = lines
      .filter((l) => l.section === "employment" || l.section === "internships")
      .filter((l) => !/^Start\s*\|\s*End\s*\|/i.test(l.text))
      .filter((l) => {
        const cells = l.text.split(/\s*\|\s*/);
        // Column labels are not a preceding employment header. Leaving them in
        // the block hides the actual role/employer carried beside its dates.
        return !(
          cells.length >= 3 &&
          cells.every((c) =>
            /^(?:employer|company|organization|designation|job title|role|dates?|start|end|start date|end date|location|employment type)$/i.test(
              c,
            ),
          )
        );
      })
      .map((l) => {
        const cells = l.text.split(/\s*\|\s*/);
        return cells.length >= 2 &&
          parseDate(cells[0]) &&
          (/^(present|current|now)$/i.test(cells[1]) || parseDate(cells[1]))
          ? {
              ...l,
              text: `${cells[0]} - ${cells[1]}${cells.length > 2 ? " | " + cells.slice(2).join(" | ") : ""}`,
            }
          : l;
      });
    // An explicitly named internship can be real without a continuous date
    // interval. Keep separately stated year activities in its description.
    const undated = new Set<SectionLine>();
    for (let index = 0; index < source.length && employment.length < 100; index++) {
      const line = source[index];
      if (line.section !== "internships") continue;
      const header = internshipHeader(line.text);
      if (!header) continue;
      let end = index + 1;
      while (end < source.length && source[end].section === "internships" && !internshipHeader(source[end].text)) end++;
      const block = source.slice(index, end);
      if (block.some((l) => dateRange(l.text))) continue;
      const companyLocation = header[2].match(/^(.*\b(?:ltd|limited|inc|llc|corporation)\.?),\s*(.+)$/i);
      const entry: Entry = {
        position: employment.length,
        employer: companyLocation?.[1] ?? header[2],
        designation: header[1],
        location: companyLocation?.[2] ?? null,
        employmentType: "Internship",
        startDate: null,
        endDate: null,
        isCurrent: null,
        description: block.slice(1).map((l) => l.text).join("\n").slice(0, 10000) || null,
        responsibilities: block.slice(1).filter((l) => bullet.test(l.text)).slice(0, 50).map((l) => strip(l.text)),
        achievements: [],
      };
      allEvidence.push(...proofs(`employment.${employment.length}`, entry, block, 0.8));
      employment.push(entry);
      block.forEach((l) => undated.add(l));
      warnings.push("INTERNSHIP_DATES_UNRESOLVED");
      index = end - 1;
    }
    const datedSource = source.filter((l) => !undated.has(l));
    const blocks = datedBlocks(datedSource);
    if (datedSource.length && !blocks.length) warnings.push("UNRESOLVED_EMPLOYMENT");
    for (const block of blocks.slice(0, 100)) {
      const section = block[0].section;
      const dates = block.map((l) => dateRange(l.text)).find(Boolean);
      if (!dates) {
        warnings.push("UNRESOLVED_EMPLOYMENT");
        continue;
      }
      const dateIndex = block.findIndex((l) => dateRange(l.text));
      const header = (
        dateIndex > 0
          ? block
              .slice(0, dateIndex)
              .map((l) => l.text)
              .join(" ")
          : block[0].text
      )
        .replace(dates.matched, "")
        .replace(/[-|\s]+$/, " ")
        .trim();
      const stacked = dateIndex === 1 && block[0].page === block[1].page &&
        block[1].line === block[0].line + 1 ? stackedEmploymentHeader(block[0].text, block[1].text) : null;
      const designation = stacked?.designation ??
        labeled(block, "designation|job title|role") ??
        extractResumeFields(block[dateIndex].text.replace(dates.matched, "").split(/\s*\|\s*/).filter(c => !/\b(?:ltd|limited|inc|llc|corporation)\b/i.test(c)).join(" | "))
          .designation ??
        (block[dateIndex].text.includes("|") &&
          !header.toLowerCase().startsWith(extractResumeFields(header).designation?.toLowerCase() ?? "\0")
          ? null : extractResumeFields(header).designation);
      if (
        /\b(?:client|project(?: name| title)?)\s*:/i.test(header) &&
        !/\b(?:employer|company|organization)\s*:/i.test(header)
      ) {
        warnings.push("AMBIGUOUS_EMPLOYER_CLIENT", "PROJECT_AS_EMPLOYMENT");
        allEvidence.push(
          ...block
            .slice(0, 6)
            .map((line) =>
              evidence(
                "observed.employment",
                line,
                ["AMBIGUOUS_EMPLOYER_CLIENT"],
                0,
              ),
            ),
        );
        continue;
      }
      let employer = stacked?.employer ?? labeled(block, "employer|company|organization");
      const at = header.match(/\s+at\s+(.+)$/i);
      if (!employer && at) employer = at[1].trim();
      if (!employer && designation) {
        const separated = header.match(/^(.+?)\s+-\s+(.+)$/);
        if (
          separated &&
          separated[1].toLowerCase().includes(designation.toLowerCase())
        )
          employer = separated[2].trim();
        else if (
          dateIndex > 1 &&
          !extractResumeFields(block[0].text).designation &&
          /\b(?:limited|ltd|llc|inc|corporation|contracting|construction)\b/i.test(
            block[0].text,
          )
        )
          employer = block[0].text.split(/\s+-\s+/)[0].trim();
      }
      const cells = header.split(/\s*[|]\s*/).filter(Boolean);
      if (!employer && cells.length === 1 && /\b(?:ltd|limited|inc|llc|corporation)\b/i.test(cells[0]))
        employer = cells[0];
      if (!employer && cells.length >= 2 && designation)
        employer = cells.find(
          (c) =>
            !c.toLowerCase().includes(designation.toLowerCase()) &&
            !/^location:/i.test(c),
        );
      if (!employer && !designation) {
        warnings.push("UNRESOLVED_EMPLOYMENT");
        continue;
      }
      if (!employer) warnings.push("UNCERTAIN_EMPLOYER");
      const joined: SectionLine[] = [];
      for (const l of block) {
        const prior = joined[joined.length - 1];
        if (
          prior &&
          bullet.test(prior.text) &&
          !bullet.test(l.text) &&
          !dateRange(l.text) &&
          !/\||^https?:|^[\w ]+:/i.test(l.text)
        )
          prior.text += " " + l.text;
        else joined.push({ ...l });
      }
      const responsibilities = joined
        .filter(
          (l) =>
            bullet.test(l.text) &&
            !/\b(?:increased|reduced|improved|awarded|achieved|saved|grew)\b/i.test(
              l.text,
            ),
        )
        .map((l) => strip(l.text));
      const achievements = joined
        .filter(
          (l) =>
            bullet.test(l.text) &&
            /\b(?:increased|reduced|improved|awarded|achieved|saved|grew)\b/i.test(
              l.text,
            ),
        )
        .map((l) => strip(l.text));
      const entry: Entry = {
        employer: employer ?? null,
        designation: designation ?? null,
        // An adjacent cell may be the employer, not a work location.
        location: labeled(block, "location") ?? stacked?.location ?? null,
        employmentType:
          section === "internships"
            ? "Internship"
            : /\bfreelance\b/i.test(header)
              ? "Freelance"
              : (labeled(block, "employment type") ??
                block[dateIndex].text.match(
                  /\b(Full-time|Part-time(?: contract)?|Residency)\b/i,
                )?.[0] ??
                null),
        startDate: dates.startDate,
        endDate: dates.endDate,
        isCurrent: dates.isCurrent,
        responsibilities,
        achievements,
      };
      // Tools stay in source-supported description and normalized resume skills, never invented.
      const body = block
        .slice(1)
        .filter((l) => !dateRange(l.text))
        .map((l) => l.text)
        .join("\n");
      if (body) entry.description = body.slice(0, 10000);
      // Multiple comma/semicolon-separated intervals on the same owned role row
      // are separate source claims, not one continuous span. Keep overlaps.
      const intervals = [dates];
      let tail = block[dateIndex].text.slice(block[dateIndex].text.indexOf(dates.matched) + dates.matched.length).trim();
      const ownedIntervalRow = stacked || (designation && block[dateIndex].text.toLowerCase().startsWith(designation.toLowerCase()));
      while (ownedIntervalRow && /^(?:[,;|]|and\b)/i.test(tail)) {
        tail = tail.replace(/^(?:[,;|]|and\b)\s*/i, "");
        const next = dateRange(tail);
        if (!next || !tail.startsWith(next.matched)) break;
        intervals.push(next);
        tail = tail.slice(next.matched.length).trim();
      }
      for (const interval of intervals) {
        if (employment.length >= 100) break;
        const position = employment.length;
        const item = { ...entry, position, startDate: interval.startDate, endDate: interval.endDate, isCurrent: interval.isCurrent };
        employment.push(item);
        allEvidence.push(...proofs(`employment.${position}`, item, block, employer ? 0.86 : 0.62));
      }
    }
  }
  for (const block of namedBlocks(
    lines.filter((l) => l.section === "education" && !/^(?:bachelor|master)[’']s degree$/i.test(l.text)),
    "education",
  ).slice(0, 100)) {
    const first = block[0].text;
    const degree =
      labeled(block, "degree|qualification") ?? qualification(first);
    const educationText = block.map((l) => l.text).join(" ");
    // Split a compact degree/institution row only when its ownership is explicit.
    // Do not collapse multi-school tables or choose one of several affiliations.
    const institutionCells = block.filter(l => qualification(l.text)).flatMap(l => l.text.split(/\s*\|\s*/)).filter(cell =>
      /\b(?:university|college|institute|school)\b/i.test(cell) && !qualification(cell));
    const institutionCell = institutionCells.length === 1 ? institutionCells[0] : undefined;
    const institutionYear = degree ? institutionCell?.match(/,\s*((?:19|20|21)\d{2})$/)?.[1] : undefined;
    const institution =
      labeled(block, "institution|university|college|school") ??
      educationText.match(/\(([^()]*\b(?:university|college|institute|school)\b[^()]*)\)/i)?.[1] ??
      (institutionCell && (institutionYear ? institutionCell.replace(/,\s*\d{4}$/, "").trim() : institutionCell)) ??
      block.find(
        (l) =>
          /\b(university|college|institute|school)\b/i.test(l.text) &&
          !qualification(l.text),
      )?.text;
    if (!degree && !institution) {
      warnings.push("UNRESOLVED_EDUCATION");
      continue;
    }
    const dates = block.map((l) => dateRange(l.text)).find(Boolean);
    const completion = labeled(
      block,
      "completed|completion date|graduated|graduation year",
    );
    const fields = first.match(/\bin\s+(.+?)(?:\s*[|,]|$)/i);
    const gradeLine = block.find((l) =>
      /\b(?:cgpa|gpa|grade|percentage)\s*:/i.test(l.text),
    );
    const grade = gradeLine?.text.match(
      /(?:cgpa|gpa|grade|percentage)\s*:\s*(\d+(?:\.\d+)?%?|[A-Za-z][A-Za-z ]*?)(?:\s*\/\s*(\d+(?:\.\d+)?))?(?:\s*\||$)/i,
    );
    const entry: Entry = {
      position: education.length,
      degree: degree ?? null,
      institution: institution ?? null,
      fieldOfStudy:
        labeled(block, "field of study|major") ??
        (degree ? first.slice(first.indexOf(degree) + degree.length).match(/^\s*(?:,|-|in)\s+([^|(]+)/i)?.[1]?.trim() : null) ??
        (fields && degree && !degree.includes(fields[1]) ? fields[1] : null),
      location: labeled(block, "location") ?? null,
      startDate: dates?.startDate ?? null,
      endDate: dates?.endDate ?? (completion ? parseDate(completion) :
        !dates && degree && institution ? parseDate(institutionYear ?? (block.length === 3 && block[1].text === institution ? block[2].text : "")) : null),
      grade: grade?.[1] ?? null,
      gradeScale: grade?.[2] ?? null,
      description: block
        .map((l) => l.text)
        .join("\n")
        .slice(0, 10000),
    };
    education.push(entry);
    allEvidence.push(
      ...proofs(`education.${education.length - 1}`, entry, block, 0.85),
    );
  }
  const projectLines = lines.filter((l) => l.section === "projects" && !/^(?:current project|project handled)$/i.test(l.text)).map((l) => ({
    ...l,
    // A two-cell label/value table is equivalent to an explicit source label.
    text: l.text.replace(/^(project|client|company|contractor|description|responsibilities)\s*\|\s*/i, "$1: "),
  }));
  // Projects require an explicit named header. Unlabelled prose is retained as a description, not many invented projects.
  const projectStarts = projectLines.flatMap((l, i) =>
    /^(?:project|project name|name)\s*:/i.test(l.text) ||
    (!bullet.test(l.text) &&
      !dateRange(l.text) &&
      l.text.length < 200 &&
      Boolean(dateRange(projectLines[i + 1]?.text ?? "")))
      ? [i]
      : [],
  );
  if (!projectStarts.length && projectLines.length) projectStarts.push(0);
  for (const [i, start] of projectStarts.slice(0, 100).entries()) {
    const block = projectLines.slice(
      start,
      projectStarts[i + 1] ?? projectLines.length,
    );
    const name = block[0].text.replace(
      /^(?:project|project name|name)\s*:\s*/i,
      "",
    ).replace(/:\s*$/, "");
    if (
      bullet.test(name) ||
      name.length > 200 ||
      /^(built|developed|worked|created|implemented|responsible)\b/i.test(name)
    ) {
      warnings.push("UNRESOLVED_PROJECT");
      continue;
    }
    const dates = block.map((l) => dateRange(l.text)).find(Boolean);
    const skills = extractSkills(block).items.map((s) => ({
      name: s.name,
      aliases: s.aliases,
      category: s.category,
    }));
    const entry: Entry = {
      position: projects.length,
      name,
      description:
        block
          .slice(1)
          .map((l) => l.text)
          .join("\n")
          .slice(0, 10000) || null,
      role:
        labeled(block, "role") ??
        block
          .find((l) => dateRange(l.text))
          ?.text.split(/\s*\|\s*/)
          .find((cell) => !dateRange(cell)) ??
        null,
      url: url(block) ?? null,
      startDate: dates?.startDate ?? null,
      endDate: dates?.endDate ?? null,
      responsibilities: block
        .filter(
          (l) =>
            bullet.test(l.text) &&
            !/\b(?:increased|reduced|improved|awarded|achieved|saved|grew)\b/i.test(
              l.text,
            ),
        )
        .map((l) => strip(l.text)),
      achievements: block
        .filter(
          (l) =>
            bullet.test(l.text) &&
            /\b(?:increased|reduced|improved|awarded|achieved|saved|grew)\b/i.test(
              l.text,
            ),
        )
        .map((l) => strip(l.text)),
      skills,
    };
    projects.push(entry);
    allEvidence.push(
      ...proofs(`projects.${projects.length - 1}`, entry, block, 0.82),
    );
    for (const skill of skills)
      allEvidence.push(
        ...block
          .filter((l) =>
            extractSkills([l]).items.some((s) => s.name === skill.name),
          )
          .map((l) =>
            evidence(
              `projects.${projects.length - 1}.skills`,
              l,
              ["EXPLICIT_TECHNOLOGY"],
              0.85,
            ),
          ),
      );
  }
  let certificationLines: SectionLine[] = [];
  for (const line of lines.filter((l) => l.section === "certifications")) {
    const previous = certificationLines.at(-1);
    if (previous && bullet.test(previous.text) && !bullet.test(line.text) && /(?:and|in|of|&)\s*$/i.test(previous.text))
      previous.text += " " + line.text;
    else certificationLines.push({ ...line });
  }
  certificationLines = certificationLines.map((l) => ({ ...l, text: strip(l.text) }));
  const groupedCertificationLines = new Set<number>();
  certificationLines = certificationLines.flatMap((line, index, source) => {
    const cells = line.text.split(/\s*\|\s*/);
    // Split only unlabelled lists in an explicit certification section. A
    // credential/issuer/date table is a relationship, not a list of credentials.
    if (/^(?:issuer|issued by|issued|issue date|expires|expiry date|credential id|credential url)\s*:/i.test(source[index + 1]?.text ?? "") ||
      cells.length < 2 || cells.some((cell) => !cell || cell.length > 200 || /:|https?:/i.test(cell) ||
      /^(?:credential\s*\/\s*issuer|issued\s*\/\s*expiry|issuer|issued|expiry|credential id|name)$/i.test(cell) ||
      /\b(?:19|20|21)\d{2}\b/.test(cell) || parseDate(cell) || dateRange(cell))) return [line];
    groupedCertificationLines.add(line.line);
    return cells.map((text) => ({ ...line, text }));
  });
  if (
    certificationLines.some((l) =>
      /^Credential\s*\/\s*issuer\s*\|\s*Issued\s*\/\s*expiry\s*\|/i.test(
        l.text,
      ),
    )
  ) {
    const prepared: SectionLine[] = [];
    const starts = certificationLines.flatMap((l, i) => {
      const cells = l.text.split(/\s*\|\s*/);
      return cells.length >= 3 && parseDate(cells[1].split(/\s+\/\s+/)[0])
        ? [i]
        : [];
    });
    starts.forEach((start, i) => {
      const block = certificationLines.slice(
          start,
          starts[i + 1] ?? certificationLines.length,
        ),
        cells = block[0].text.split(/\s*\|\s*/);
      const first = block
        .map((l) => l.text.split(/\s*\|\s*/)[0])
        .join(" ")
        .split(/;\s*/);
      const dates = cells[1].split(/\s+\/\s+/);
      for (const text of [
        `Certification: ${first[0]}`,
        ...(first[1] ? [`Issuer: ${first.slice(1).join("; ")}`] : []),
        `Issued: ${dates[0]}`,
        ...(dates[1] && parseDate(dates[1]) ? [`Expires: ${dates[1]}`] : []),
        `Credential ID: ${cells[2]}`,
      ])
        prepared.push({ ...block[0], text });
    });
    certificationLines = prepared;
  }
  for (const block of namedBlocks(certificationLines, "certifications").slice(
    0,
    100,
  )) {
    const name = block[0].text.replace(/^(?:certification|name)\s*:\s*/i, "");
    if (bullet.test(name) || name.length > 200) continue;
    const issue = labeled(block, "issue date|issued"),
      expiry = labeled(block, "expiry date|expiration date|expires");
    const entry: Entry = {
      position: certifications.length,
      name,
      issuer:
        labeled(block, "issuer|issued by|issuing organization") ??
        (block[1] &&
        !url([block[1]]) &&
        !/^(?:issue date|issued|expiry|credential)\s*:/i.test(block[1].text)
          ? block[1].text
          : null),
      credentialId: labeled(block, "credential id|certificate id") ?? null,
      issueDate: issue ? parseDate(issue) : null,
      expiryDate: expiry ? parseDate(expiry) : null,
      url: url(block) ?? null,
    };
    certifications.push(entry);
    allEvidence.push(
      ...proofs(
        `certifications.${certifications.length - 1}`,
        entry,
        block,
        0.86,
      ).map((proof) => groupedCertificationLines.has(block[0].line)
        ? { ...proof, signals: [...proof.signals, "GROUPED_CERTIFICATION_CLAIM"] } : proof),
    );
  }
  const additionalTypes = {
    languages: "LANGUAGE",
    awards: "AWARD",
    publications: "PUBLICATION",
    volunteering: "VOLUNTEERING",
    qualifications: "QUALIFICATION",
  } as const;
  for (const [section, type] of Object.entries(additionalTypes))
    for (const block of section === "volunteering"
      ? volunteerBlocks(lines.filter((l) => l.section === section))
      : lines.filter((l) => l.section === section).map((l) => [l])) {
      const line = block[0];
      for (const title of section === "languages"
        ? line.text.split(/[,;]|\s+\/\s+/)
        : [line.text]) {
        if (additional.length >= 100) break;
        const language =
          section === "languages"
            ? title.trim().match(/^(.+?)(?:\s*\(([^)]+)\)|\s+-\s+(.+))$/)
            : null;
        const entry: Entry = {
          position: additional.length,
          type,
          title: strip(language?.[1] ?? title).slice(0, 200),
          details: {
            description: block.map((l) => l.text).join("\n").slice(0, 10000),
            ...(language ? { proficiency: language[2] ?? language[3] } : {}),
          },
        };
        if (!entry.title) continue;
        additional.push(entry);
        allEvidence.push(
          ...proofs(`additional.${additional.length - 1}`, entry, block, 0.83),
        );
      }
    }
  return {
    employment,
    education,
    projects,
    certifications,
    additional,
    evidence: allEvidence,
    warnings,
  };
}
