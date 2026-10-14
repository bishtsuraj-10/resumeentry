import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const text = (max = 200) => z.string().trim().min(1).max(max);
const nullable = (max = 200) => text(max).nullable().optional();
const strings = (max = 50) => z.array(text(1000)).max(max);
const id = text(100);

export const partialDateSchema = z
  .strictObject({
    year: z.number().int().min(1900).max(2200).nullable().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    day: z.number().int().min(1).max(31).nullable().optional(),
    text: text(100).nullable().optional(),
  })
  .superRefine((date, ctx) => {
    if (date.month != null && date.year == null)
      ctx.addIssue({ code: "custom", message: "Month requires year" });
    if (date.day != null && (date.year == null || date.month == null))
      ctx.addIssue({ code: "custom", message: "Day requires month and year" });
    if (
      date.year &&
      date.month &&
      date.day &&
      new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCMonth() !==
        date.month - 1
    )
      ctx.addIssue({ code: "custom", message: "Invalid calendar date" });
    if (date.year == null && !date.text)
      ctx.addIssue({
        code: "custom",
        message: "Supply a date component or original text",
      });
  });

export const safeUrlSchema = text(2000).transform((value, ctx) => {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    url.hash = "";
    if (url.pathname === "/") url.pathname = "/";
    return url.toString();
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Use an absolute HTTP or HTTPS URL without credentials",
    });
    return z.NEVER;
  }
});
const evidenceSchema = z.strictObject({
  sourceSection: nullable(100),
  text: nullable(500),
  location: z
    .strictObject({
      page: z.number().int().min(1).max(10000).optional(),
      lineStart: z.number().int().min(1).max(100000).optional(),
      lineEnd: z.number().int().min(1).max(100000).optional(),
    })
    .refine(
      (v) => !v.lineStart || !v.lineEnd || v.lineEnd >= v.lineStart,
      "Invalid line range",
    )
    .optional(),
});
const evidence = z.array(evidenceSchema).max(10).optional();
const period = {
  startDate: partialDateSchema.nullable().optional(),
  endDate: partialDateSchema.nullable().optional(),
};
const ordered = {
  id: id.optional(),
  position: z.number().int().min(0).max(499).optional(),
  evidence,
};

const employment = z.strictObject({
  ...ordered,
  ...period,
  employer: nullable(),
  designation: nullable(),
  location: nullable(),
  employmentType: nullable(100),
  isCurrent: z.boolean().nullable().optional(),
  description: nullable(10000),
  responsibilities: strings().optional(),
  achievements: strings().optional(),
});
const education = z.strictObject({
  ...ordered,
  ...period,
  degree: nullable(),
  fieldOfStudy: nullable(),
  institution: nullable(),
  location: nullable(),
  grade: nullable(100),
  gradeScale: nullable(100),
  description: nullable(10000),
});
const skill = z.strictObject({
  name: text(120),
  aliases: z.array(text(120)).max(20).optional(),
  category: nullable(80),
  originalText: nullable(500),
  context: nullable(200),
  evidence,
});
const project = z.strictObject({
  ...ordered,
  ...period,
  name: nullable(),
  description: nullable(10000),
  role: nullable(),
  url: safeUrlSchema.nullable().optional(),
  responsibilities: strings().optional(),
  achievements: strings().optional(),
  skills: z
    .array(skill.omit({ originalText: true, context: true, evidence: true }))
    .max(50)
    .optional(),
});
const certification = z.strictObject({
  ...ordered,
  name: nullable(),
  issuer: nullable(),
  credentialId: nullable(),
  issueDate: partialDateSchema.nullable().optional(),
  expiryDate: partialDateSchema.nullable().optional(),
  url: safeUrlSchema.nullable().optional(),
});
const link = z.strictObject({
  id: id.optional(),
  type: z
    .enum(["LINKEDIN", "GITHUB", "PORTFOLIO", "WEBSITE", "OTHER"])
    .optional(),
  url: safeUrlSchema.optional(),
  label: nullable(),
  evidence,
});
// A bounded shape covers languages, publications, awards and other less common sections.
const additional = z.strictObject({
  ...ordered,
  type: z
    .enum([
      "LANGUAGE",
      "AWARD",
      "PUBLICATION",
      "VOLUNTEERING",
      "INTERNSHIP",
      "QUALIFICATION",
    ])
    .optional(),
  title: nullable(),
  details: z
    .strictObject({
      organization: nullable(),
      description: nullable(10000),
      proficiency: nullable(100),
      url: safeUrlSchema.nullable().optional(),
      startDate: partialDateSchema.nullable().optional(),
      endDate: partialDateSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});
const changeSet = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    upsert: z.array(item).max(100).optional(),
    remove: z.array(id).max(100).optional(),
  });

const phoneSchema = text(40).transform((value, ctx) => {
  const phone = parsePhoneNumberFromString(value);
  if (!phone?.isValid()) {
    ctx.addIssue({
      code: "custom",
      message: "Use a valid international phone number",
    });
    return z.NEVER;
  }
  return {
    originalText: value,
    normalizedPhone: phone.number,
    countryCode: "+" + phone.countryCallingCode,
  };
});
const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00.000Z");
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === v &&
      v >= "1900-01-01" &&
      d <= new Date()
    );
  }, "Invalid explicit date of birth");

export const candidatePatchSchema = z
  .strictObject({
    expectedRevision: z.number().int().min(0).max(2147483646),
    basic: z
      .strictObject({
        name: nullable(),
        email: z
          .string()
          .trim()
          .email()
          .transform((v) => v.toLowerCase())
          .nullable()
          .optional(),
        phone: text(40)
          .refine(
            (v) => Boolean(parsePhoneNumberFromString(v)?.isValid()),
            "Use a valid international phone number",
          )
          .nullable()
          .optional(),
        designation: nullable(),
      })
      .optional(),
    completeReview: z.literal(true).optional(),
    profile: z
      .strictObject({
        firstName: nullable(),
        lastName: nullable(),
        additionalEmails: z
          .array(
            z
              .string()
              .trim()
              .email()
              .transform((v) => v.toLowerCase()),
          )
          .max(20)
          .optional(),
        additionalPhones: z.array(phoneSchema).max(20).optional(),
        city: nullable(),
        region: nullable(),
        country: nullable(),
        locationText: nullable(500),
        dateOfBirth: dobSchema.nullable().optional(),
        headline: nullable(500),
        summary: nullable(20000),
        objective: nullable(10000),
        totalExperienceMonths: z
          .number()
          .int()
          .min(0)
          .max(1200)
          .nullable()
          .optional(),
        noticePeriod: nullable(200),
        employmentPreferences: z.array(text(200)).max(20).optional(),
        evidence,
      })
      .optional(),
    skills: z
      .strictObject({
        upsert: z.array(skill).max(100).optional(),
        remove: z.array(id).max(100).optional(),
      })
      .optional(),
    employment: changeSet(employment).optional(),
    education: changeSet(education).optional(),
    projects: changeSet(project).optional(),
    certifications: changeSet(certification).optional(),
    links: changeSet(link).optional(),
    additional: changeSet(additional).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !Object.entries(value).some(([key, item]) =>
        item === undefined
          ? false
          : key === "completeReview"
            ? item === true
            : key === "profile" || key === "basic"
              ? Object.keys(item as object).some((key) => key !== "evidence")
              : key !== "expectedRevision" &&
                ((item as { upsert?: unknown[]; remove?: unknown[] }).upsert
                  ?.length ||
                  (item as { remove?: unknown[] }).remove?.length),
      )
    )
      ctx.addIssue({ code: "custom", message: "Supply candidate changes" });
    let total = 0;
    let taxonomyTerms = 0;
    let evidenceCount = value.profile?.evidence?.length ?? 0;
    for (const [section, changes] of Object.entries(value)) {
      if (
        section === "profile" ||
        section === "basic" ||
        section === "completeReview" ||
        section === "expectedRevision" ||
        changes === undefined
      )
        continue;
      const set = changes as {
        upsert?: { id?: string; position?: number }[];
        remove?: string[];
      };
      total += (set.upsert?.length ?? 0) + (set.remove?.length ?? 0);
      for (const item of set.upsert ?? []) {
        const nested = item as {
          aliases?: string[];
          evidence?: unknown[];
          skills?: { aliases?: string[] }[];
        };
        if (section === "skills")
          taxonomyTerms += 1 + (nested.aliases?.length ?? 0);
        for (const skill of nested.skills ?? [])
          taxonomyTerms += 1 + (skill.aliases?.length ?? 0);
        evidenceCount += nested.evidence?.length ?? 0;
      }
      const ids =
        set.upsert?.flatMap((item) => (item.id ? [item.id] : [])) ?? [];
      const positions =
        set.upsert?.flatMap((item) =>
          item.position != null ? [item.position] : [],
        ) ?? [];
      if (
        new Set(ids).size !== ids.length ||
        new Set(set.remove ?? []).size !== (set.remove?.length ?? 0) ||
        ids.some((key) => set.remove?.includes(key)) ||
        new Set(positions).size !== positions.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate or conflicting entries",
          path: [section],
        });
    }
    if (total > 100 || taxonomyTerms > 200 || evidenceCount > 200)
      ctx.addIssue({
        code: "custom",
        message: "Candidate update exceeds the bounded operation budget",
      });
  });
export type CandidatePatch = z.infer<typeof candidatePatchSchema>;
export type PartialCandidateDate = z.infer<typeof partialDateSchema>;
export type CandidateEvidenceInput = z.infer<typeof evidenceSchema>;

export function normalizeSkillName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}
