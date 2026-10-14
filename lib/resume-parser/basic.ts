import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
export interface ResumeParser {
  canParse(fileType: string): boolean;
  extractText(filePath: string): Promise<{
    text: string;
    usedOcr: boolean;
  }>;
}
export interface ResumeExtraction {
  name: string | null;
  nameConfidence: number;
  email: string | null;
  emailConfidence: number;
  phone: string | null;
  countryCode: string | null;
  normalizedPhone: string | null;
  phoneConfidence: number;
  designation: string | null;
  designationConfidence: number;
  overallConfidence: number;
}
const emailSchema = z.string().email();
const cleanName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L} .'-]/gu, "");
const titleCase = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
const titlePatterns = [
  "Registered Nurse",
  "Staff Nurse",
  "Nurse",
  "Sales Executive",
  "HR Executive",
  "HR Specialist",
  "Chartered Accountant",
  "Finance Manager",
  "Recruiter",
  "Physiotherapist",
  "Engineering Manager",
  "Software Architect",
  "Senior Software Engineer",
  "Software Engineer",
  "Full Stack Developer",
  "Frontend Developer",
  "Back End Developer",
  "Backend Developer",
  "DevOps Engineer",
  "Data Scientist",
  "Data Analyst",
  "Product Designer",
  "Product Manager",
  "Project Manager",
  "HR Manager",
  "Human Resources Manager",
  "Business Analyst",
  "Marketing Manager",
  "UX Designer",
  "Graphic Designer",
  "Quality Assurance Engineer",
  "QA Engineer",
  "Accountant",
  "Operations Manager",
  "Technical Lead",
  "Tech Lead",
  "Consultant",
  "Sales Manager",
  "Customer Success Manager",
];
const titleRegex = new RegExp(
  `\\b(${titlePatterns
    .sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"))
    .join("|")})\\b`,
  "i",
);
const roleNouns =
  "developer|engineer|analyst|manager|accountant|nurse|teacher|designer|executive|pharmacist|paralegal|chef|scientist|coordinator|administrator|supervisor|assistant|consultant|architect|recruiter|specialist|planner|fellow|resident|representative|tutor|director|associate|partner|chef de partie";
// Full standalone roles preserve seniority and specialties. Dictionary matching
// remains a fallback for prose, not a prerequisite for recognizing a job header.
export function jobTitle(line: string): string | null {
  const candidate = line
    .replace(/^(?:designation|job title|role)\s*:\s*/i, "")
    .split(/\s*[|\t]\s*|\s+at\s+/i)[0]
    .trim();
  if (
    candidate.length <= 100 &&
    new RegExp(
      `^(?:[\\p{L}][\\p{L}./&'-]*\\s+){0,6}(?:${roleNouns})$`,
      "iu",
    ).test(candidate)
  )
    return candidate === candidate.toUpperCase()
      ? titleCase(candidate)
          .replace(/\b(Hr|Qa|Ux|It)\b/g, (s) => s.toUpperCase())
          .replace(/\bDevops\b/g, "DevOps")
      : candidate;
  return line.match(titleRegex)?.[0] ?? null;
}
export function extractResumeFields(
  text: string,
  fileName?: string,
): ResumeExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const emails = [
    ...new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((email) => email.toLowerCase())
        .filter((email) => emailSchema.safeParse(email).success),
    ),
  ];
  const email = emails[0] ?? null;
  const phoneMatches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  const phoneCandidates = phoneMatches
    .map((candidate) => {
      const parsed = parsePhoneNumberFromString(
        candidate.replace(/[().\s-]/g, ""),
        "IN",
      );
      return parsed?.isValid() ? parsed : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const phone = phoneCandidates[0] ?? null;
  const likelyName = lines.slice(0, 14).find((line, index) => {
    if (
      index > 8 ||
      line.length < 4 ||
      line.length > 54 ||
      /@|\d|[:|]|resume|curriculum|portfolio|profile|summary|experience|education|phone|address|linkedin/i.test(
        line,
      ) ||
      jobTitle(line)
    )
      return false;
    const words = cleanName(line).split(" ");
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every(
        (word) => word.length > 1 && /^[\p{L}][\p{L}'-]*$/u.test(word),
      )
    );
  });
  const fallback =
    fileName
      ?.replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() ?? "";
  const name = likelyName
    ? titleCase(cleanName(likelyName))
    : fallback
      ? titleCase(cleanName(fallback))
      : null;
  const titleMatches = lines
    .map((line, index) => {
      const title = jobTitle(line);
      if (!title) return null;
      const nextLine = lines[index + 1] ?? "";
      const context = jobTitle(nextLine) ? line : `${line} ${nextLine}`;
      const current =
        /\b(present|current|now)\b/i.test(line) ||
        (!jobTitle(nextLine) && /\b(present|current|now)\b/i.test(nextLine));
      const yearMatch = context.match(
        /(?:19|20)\d{2}\s*(?:-|\u2013|to)\s*((?:19|20)\d{2}|present|current|now)/i,
      );
      const endYear = yearMatch?.[1]
        ? /^(present|current|now)$/i.test(yearMatch[1])
          ? 9999
          : Number(yearMatch[1])
        : undefined;
      const firstExperience = lines.findIndex((entry) =>
        /\b(experience|employment|work history)\b/i.test(entry),
      );
      const headerTitle =
        index < 8 && (firstExperience < 0 || index < firstExperience);
      return {
        title,
        index,
        score: current ? 10000 : headerTitle ? 5000 - index : (endYear ?? 0),
      };
    })
    .filter(
      (
        match,
      ): match is {
        title: string;
        index: number;
        score: number;
      } => Boolean(match),
    );
  const titleCandidate = titleMatches.sort((a, b) => b.score - a.score)[0];
  const titleMatch = titleCandidate?.title;
  const designation = titleMatch ?? null;
  const nameConfidence = likelyName
    ? lines.indexOf(likelyName) <= 3
      ? 0.94
      : 0.82
    : name
      ? 0.35
      : 0;
  const designationConfidence = designation
    ? titleCandidate && titleCandidate.score >= 1000
      ? 0.92
      : titleCandidate && titleCandidate.index < 8
        ? 0.86
        : 0.66
    : 0;
  const emailConfidence = email ? 0.99 : 0;
  const phoneConfidence = phone ? (phone.country === "IN" ? 0.96 : 0.89) : 0;
  const scores = [
    nameConfidence,
    emailConfidence,
    phoneConfidence,
    designationConfidence,
  ].filter((score) => score > 0);
  return {
    name,
    nameConfidence,
    email,
    emailConfidence,
    phone: phone?.formatInternational() ?? null,
    countryCode: phone?.countryCallingCode
      ? `+${phone.countryCallingCode}`
      : null,
    normalizedPhone: phone?.number ?? null,
    phoneConfidence,
    designation,
    designationConfidence,
    overallConfidence: scores.length
      ? scores.reduce((total, score) => total + score, 0) / 4
      : 0,
  };
}
export function isCandidateDuplicate(
  candidate: Pick<ResumeExtraction, "name" | "email" | "normalizedPhone">,
  previous: Pick<ResumeExtraction, "name" | "email" | "normalizedPhone">,
) {
  if (
    candidate.email &&
    previous.email &&
    candidate.email.toLowerCase() === previous.email.toLowerCase()
  )
    return true;
  if (
    candidate.normalizedPhone &&
    previous.normalizedPhone &&
    candidate.normalizedPhone === previous.normalizedPhone
  )
    return true;
  return Boolean(
    candidate.name &&
    previous.name &&
    candidate.normalizedPhone &&
    previous.normalizedPhone &&
    candidate.name.trim().toLowerCase() ===
      previous.name.trim().toLowerCase() &&
    candidate.normalizedPhone === previous.normalizedPhone,
  );
}
export interface ResumeAIParser {
  parseResume(text: string): Promise<Partial<ResumeExtraction>>;
}
export class ConfiguredAIParser implements ResumeAIParser {
  async parseResume(text: string) {
    const provider = process.env.AI_PROVIDER;
    const apiKey = process.env.AI_API_KEY;
    const endpoint = process.env.AI_API_URL;
    if (
      process.env.AI_PARSING_ENABLED !== "true" ||
      !provider ||
      !apiKey ||
      !endpoint
    )
      return {};
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider,
        task: "Extract candidate name and current designation. Return JSON only.",
        text: text.slice(0, 30000),
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`AI parser returned HTTP ${response.status}`);
    const parsed = (await response.json()) as Partial<ResumeExtraction>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      designation:
        typeof parsed.designation === "string" ? parsed.designation : undefined,
    };
  }
}
