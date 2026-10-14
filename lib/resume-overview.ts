import type { Prisma } from "@prisma/client";

// Prisma batches these nested selections; no per-row database calls or evidence reads.
export const resumeOverviewSelect = {
  id: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  status: true,
  createdAt: true,
  extraction: {
    select: {
      name: true,
      email: true,
      phone: true,
      designation: true,
      overallConfidence: true,
      reviewedAt: true,
    },
  },
  candidate: {
    select: {
      firstName: true,
      lastName: true,
      headline: true,
      locationText: true,
      city: true,
      region: true,
      country: true,
      totalExperienceMonths: true,
      skills: {
        take: 5,
        orderBy: [{ confidence: "desc" }, { skillId: "asc" }],
        select: { skill: { select: { canonicalName: true } } },
      },
      education: {
        take: 100,
        select: {
          degree: true,
          fieldOfStudy: true,
          institution: true,
          endYear: true,
        },
        orderBy: { position: "asc" },
      },
    },
  },
} satisfies Prisma.ResumeSelect;
type OverviewInput = Prisma.ResumeGetPayload<{
  select: typeof resumeOverviewSelect;
}>;
export type ResumeOverviewRow = {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  extraction: {
    name: string | null;
    email: string | null;
    phone: string | null;
    designation: string | null;
    overallConfidence: number;
  } | null;
  overview: {
    name: string | null;
    designation: string | null;
    location: string | null;
    totalExperienceMonths: number | null;
    skills: string[];
    education: string | null;
  };
};
export function highestEducation<
  T extends {
    degree: string | null;
    fieldOfStudy: string | null;
    endYear: number | null;
  },
>(records: T[]): T | undefined {
  const rank = (degree: string | null) =>
    /doctor|ph\.?d/i.test(degree ?? "")
      ? 5
      : /master|\bm(?:ba|sc|a|s)\b/i.test(degree ?? "")
        ? 4
        : /bachelor|\bb(?:sc|tech|a|s|ba)\b/i.test(degree ?? "")
          ? 3
          : /associate/i.test(degree ?? "")
            ? 2
            : /diploma|certificate/i.test(degree ?? "")
              ? 1
              : 0;
  return [...records]
    .filter((r) => r.degree)
    .sort(
      (a, b) =>
        rank(b.degree) - rank(a.degree) || (b.endYear ?? 0) - (a.endYear ?? 0),
    )[0];
}
export function resumeOverview(row: OverviewInput) {
  const p = row.candidate,
    e = row.extraction,
    education = highestEducation(p?.education ?? []);
  return {
    name:
      e?.name ||
      (!e?.reviewedAt
        ? [p?.firstName, p?.lastName].filter(Boolean).join(" ") || null
        : null),
    designation:
      e?.designation || (!e?.reviewedAt ? p?.headline : null) || null,
    location:
      p?.locationText ||
      [p?.city, p?.region, p?.country].filter(Boolean).join(", ") ||
      null,
    totalExperienceMonths: p?.totalExperienceMonths ?? null,
    skills: p?.skills.map((s) => s.skill.canonicalName) ?? [],
    education: education
      ? [education.degree, education.fieldOfStudy].filter(Boolean).join(" · ")
      : null,
  };
}
