import type { SectionLine, Section } from "../section-detector";
import { evidence, type MachineEvidence } from "../field-confidence";
import { dateRange, parseDate } from "../validators/dates";
import { extractResumeFields } from "../basic";
import { extractSkills } from "./skills";
import { safeUrlSchema } from "../../candidate-validation";
type Entry = Record<string, unknown>;
const bullet = /^[-•*]\s*/;
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
    if (
      i > 0 &&
      !dateRange(lines[i - 1].text) &&
      !bullet.test(lines[i - 1].text) &&
      (/[|]|\bat\b|^(employer|company|designation):/i.test(lines[i - 1].text) ||
        extractResumeFields(lines[i - 1].text).designation)
    )
      start = i - 1;
    if (
      start === i &&
      i > 1 &&
      !bullet.test(lines[i - 1].text) &&
      !dateRange(lines[i - 1].text) &&
      /[|]|\bat\b/i.test(lines[i - 2].text) &&
      !bullet.test(lines[i - 2].text)
    )
      start = i - 2;
    // Employer on one line, title on the next, followed by dates.
    if (start > 0 && /^(employer|company):/i.test(lines[start - 1].text))
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
      /^(description|role|technolog(?:y|ies)|tools|responsibilities|achievements|issuer|issued by|issuing organization|credential id|credential url|issue date|issued|expiry date|expiration date|url|link|institution|university|field of study|grade|cgpa|gpa|location|dates?)\s*:/i.test(
        line.text,
      ) ||
      Boolean(dateRange(line.text)) ||
      Boolean(parseDate(line.text)) ||
      /^(?:credential|verify(?: credential| certificate)?|verification|website|url|link)\s*\(https?:\/\//i.test(line.text) ||
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
const qualifications = [
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
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu"),
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
        return !(cells.length >= 3 && cells.every(c =>
          /^(?:employer|company|organization|designation|job title|role|dates?|start|end|start date|end date|location|employment type)$/i.test(c),
        ));
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
    const blocks = datedBlocks(source);
    if (source.length && !blocks.length) warnings.push("UNRESOLVED_EMPLOYMENT");
    for (const block of blocks.slice(0, 100)) {
      const section = block[0].section;
      const dates = block.map((l) => dateRange(l.text)).find(Boolean)!;
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
      const designation =
        labeled(block, "designation|job title|role") ??
        extractResumeFields(header).designation;
      let employer = labeled(block, "employer|company|organization");
      const at = header.match(/\s+at\s+(.+)$/i);
      if (!employer && at) employer = at[1].trim();
      const cells = header.split(/\s*[|]\s*/).filter(Boolean);
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
        location:
          labeled(block, "location") ??
          block[dateIndex].text.split(/\s*\|\s*/)[1]?.split(/\s*\/\s*/)[0] ??
          null,
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
      const position = employment.length;
      entry.position = position;
      employment.push(entry);
      allEvidence.push(
        ...proofs(
          `employment.${position}`,
          entry,
          block,
          employer ? 0.86 : 0.62,
        ),
      );
    }
  }
  for (const block of namedBlocks(
    lines.filter((l) => l.section === "education"),
    "education",
  ).slice(0, 100)) {
    const first = block[0].text;
    const degree =
      labeled(block, "degree|qualification") ?? qualification(first);
    const institution =
      labeled(block, "institution|university|college|school") ??
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
        (fields && degree && !degree.includes(fields[1]) ? fields[1] : null),
      location: labeled(block, "location") ?? null,
      startDate: dates?.startDate ?? null,
      endDate: dates?.endDate ?? (completion ? parseDate(completion) : null),
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
  const projectLines = lines.filter((l) => l.section === "projects");
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
    );
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
  let certificationLines = lines.filter((l) => l.section === "certifications");
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
      ),
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
    for (const line of lines.filter((l) => l.section === section)) {
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
            description: line.text.slice(0, 10000),
            ...(language ? { proficiency: language[2] ?? language[3] } : {}),
          },
        };
        if (!entry.title) continue;
        additional.push(entry);
        allEvidence.push(
          ...proofs(`additional.${additional.length - 1}`, entry, [line], 0.83),
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
