import { Prisma, type PrismaClient } from "@prisma/client";
import { transaction } from "./processing";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import {
  candidatePatchSchema,
  normalizeSkillName,
  type CandidateEvidenceInput,
  type PartialCandidateDate,
} from "./candidate-validation";

type Tx = Prisma.TransactionClient;
export class CandidateDataError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const ordered = {
  orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
};
export const candidateInclude = {
  skills: {
    select: {
      resumeId: true,
      skillId: true,
      context: true,
      originalText: true,
      confidence: true,
      verifiedAt: true,
      skill: { include: { terms: true } },
    },
    orderBy: { skillId: "asc" as const },
  },
  employment: ordered,
  education: ordered,
  projects: {
    ...ordered,
    include: {
      skills: {
        include: { skill: true },
        orderBy: { skillId: "asc" as const },
      },
    },
  },
  certifications: ordered,
  links: { orderBy: { id: "asc" as const } },
  additional: ordered,
} satisfies Prisma.CandidateProfileInclude;

export async function readCandidate(db: PrismaClient, resumeId: string) {
  const resume = await db.resume.findUnique({
    where: { id: resumeId },
    select: {
      id: true,
      extraction: {
        select: {
          name: true,
          email: true,
          phone: true,
          countryCode: true,
          normalizedPhone: true,
          designation: true,
          overallConfidence: true,
          reviewedAt: true,
        },
      },
      candidate: { include: candidateInclude },
    },
  });
  if (!resume) return null;
  return {
    resumeId,
    revision: resume.candidate?.revision ?? 0,
    basic: resume.extraction,
    candidate: resume.candidate,
  };
}

export async function readCandidateProvenance(
  db: PrismaClient,
  resumeId: string,
  page = 1,
) {
  return db.extractionRun.findMany({
    where: { resumeId },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 25,
    take: 25,
    include: {
      evidence: { orderBy: { id: "asc" }, take: 100 },
      _count: { select: { evidence: true } },
    },
  });
}

export async function readRunEvidence(
  db: PrismaClient,
  resumeId: string,
  runId: string,
  page = 1,
) {
  return db.extractionRun.findFirst({
    where: { id: runId, resumeId },
    include: {
      evidence: { orderBy: { id: "asc" }, skip: (page - 1) * 100, take: 100 },
      _count: { select: { evidence: true } },
    },
  });
}

function dateFields(prefix: string, value: PartialCandidateDate | null) {
  return Object.fromEntries(
    ["Year", "Month", "Day", "Text"].map((part) => [
      prefix + part,
      value?.[part.toLowerCase() as keyof PartialCandidateDate] ?? null,
    ]),
  );
}
function relationalData(item: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (["id", "evidence", "skills"].includes(key)) continue;
    const prefix = {
      startDate: "start",
      endDate: "end",
      issueDate: "issue",
      expiryDate: "expiry",
    }[key];
    if (prefix)
      Object.assign(
        data,
        dateFields(prefix, value as PartialCandidateDate | null),
      );
    else
      data[key] = value === null && key === "details" ? Prisma.DbNull : value;
  }
  return data;
}

async function resolveSkill(
  tx: Tx,
  input: { name: string; aliases?: string[]; category?: string | null },
) {
  const key = normalizeSkillName(input.name);
  const term = await tx.skillTerm.findUnique({
    where: { normalizedName: key },
    include: { skill: true },
  });
  let skill = term?.skill;
  if (!skill) {
    skill = await tx.skill.create({
      data: {
        canonicalName: input.name.trim(),
        normalizedName: key,
        category: input.category ?? null,
      },
    });
    await tx.skillTerm.create({
      data: {
        normalizedName: key,
        displayName: skill.canonicalName,
        skillId: skill.id,
      },
    });
  }
  // A candidate edit cannot silently rename or recategorize a shared taxonomy entry.
  if (input.category != null && input.category !== skill.category)
    throw new CandidateDataError(
      409,
      "Skill category conflicts with the existing taxonomy.",
    );
  for (const alias of input.aliases ?? []) {
    const normalizedName = normalizeSkillName(alias);
    const existing = await tx.skillTerm.findUnique({
      where: { normalizedName },
    });
    if (existing && existing.skillId !== skill.id)
      throw new CandidateDataError(409, "Skill alias is already assigned.");
    if (!existing)
      await tx.skillTerm.create({
        data: { normalizedName, displayName: alias, skillId: skill.id },
      });
  }
  return skill;
}

type Section =
  | "employment"
  | "education"
  | "projects"
  | "certifications"
  | "links"
  | "additional";
// Narrow structural delegate for the common scoped CRUD operations. Only strict
// validation output and explicit allowlisted section names reach these methods.
type StoredEntry = {
  id: string;
  resumeId: string;
  position?: number;
  isCurrent?: boolean | null;
  endYear?: number | null;
  endText?: string | null;
};
type Store = {
  findMany(args: { where: { resumeId: string } }): Promise<StoredEntry[]>;
  create(args: { data: Record<string, unknown> }): Promise<StoredEntry>;
  updateMany(args: {
    where: { id: string; resumeId: string };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  deleteMany(args: {
    where: { id: string; resumeId: string };
  }): Promise<{ count: number }>;
};
function store(tx: Tx, section: Section): Store {
  return {
    employment: tx.candidateEmployment,
    education: tx.candidateEducation,
    projects: tx.candidateProject,
    certifications: tx.candidateCertification,
    links: tx.candidateLink,
    additional: tx.candidateAdditional,
  }[section] as unknown as Store;
}

export async function patchCandidate(
  db: PrismaClient,
  resumeId: string,
  actor: string,
  input: unknown,
) {
  // Revalidate at the service boundary; never trust a TypeScript cast as validation.
  const patch = candidatePatchSchema.parse(input);
  try {
    return await transaction(db, async (tx) => {
      const resume = await tx.resume.findUnique({
        where: { id: resumeId },
        select: { status: true, batch: { select: { status: true } } },
      });
      if (!resume) throw new CandidateDataError(404, "Resume not found.");
      if (resume.status === "CANCELLED" || resume.batch?.status === "CANCELLED")
        throw new CandidateDataError(
          409,
          "Cancelled resumes cannot be edited.",
        );
      if (
        (patch.basic || patch.completeReview) &&
        !["REVIEW", "COMPLETED", "DUPLICATE"].includes(resume.status)
      )
        throw new CandidateDataError(
          409,
          "Wait for successful processing before reviewing identity or completing review.",
        );
      const existing = await tx.candidateProfile.findUnique({
        where: { resumeId },
      });
      if ((existing?.revision ?? 0) !== patch.expectedRevision)
        throw new CandidateDataError(
          409,
          "Candidate changed; reload before editing.",
        );
      if (existing) {
        const changed = await tx.candidateProfile.updateMany({
          where: { resumeId, revision: patch.expectedRevision },
          data: { revision: { increment: 1 } },
        });
        if (!changed.count)
          throw new CandidateDataError(
            409,
            "Candidate changed; reload before editing.",
          );
      } else
        await tx.candidateProfile.create({ data: { resumeId, revision: 1 } });
      const audit = await tx.auditLog.create({
        data: {
          actor,
          action: "candidate.updated",
          targetId: resumeId,
          metadata: {
            revision: patch.expectedRevision + 1,
            sections: Object.keys(patch).filter(
              (k) => k !== "expectedRevision",
            ),
          },
        },
      });
      const now = new Date();
      const run = await tx.extractionRun.create({
        data: { resumeId, method: "HUMAN", startedAt: now, completedAt: now },
      });
      async function saveEvidence(
        fieldPath: string,
        items: CandidateEvidenceInput[] | undefined,
      ) {
        // Each occurrence is retained even when skill associations are deduplicated.
        await tx.candidateEvidence.createMany({
          data: (items?.length ? items : [{}]).map((item) => ({
            runId: run.id,
            fieldPath,
            sourceSection: item.sourceSection,
            text: item.text,
            ...(item.location ? { location: item.location } : {}),
            verifiedAt: now,
            auditLogId: audit.id,
          })),
        });
      }
      if (patch.basic) {
        const values = patch.basic;
        const phone = values.phone
          ? parsePhoneNumberFromString(values.phone)
          : undefined;
        const data = {
          ...values,
          ...(values.phone !== undefined
            ? {
                phone: phone?.formatInternational() ?? null,
                normalizedPhone: phone?.number ?? null,
                countryCode: phone ? "+" + phone.countryCallingCode : null,
              }
            : {}),
          // Freeze machine replacement using M1's existing human-correction fence.
          // Per-field verification lives in evidence, not this legacy timestamp.
          reviewedAt: now,
        };
        await tx.resumeExtraction.upsert({
          where: { resumeId },
          create: { resumeId, ...data },
          update: data,
        });
        for (const field of Object.keys(values))
          await saveEvidence("basic." + field, undefined);
      }
      if (patch.completeReview) {
        if (
          !(await tx.resumeExtraction.findUnique({
            where: { resumeId },
            select: { resumeId: true },
          }))
        )
          throw new CandidateDataError(
            422,
            "No extraction is available to complete review.",
          );
        await tx.resumeExtraction.update({
          where: { resumeId },
          data: { requiresReview: false, reviewedAt: now },
        });
        if (resume.status === "REVIEW")
          await tx.resume.update({
            where: { id: resumeId },
            data: { status: "COMPLETED" },
          });
        await saveEvidence("review.completed", undefined);
      }
      if (patch.profile) {
        const { evidence, dateOfBirth, ...values } = patch.profile;
        await tx.candidateProfile.update({
          where: { resumeId },
          data: {
            ...values,
            ...(dateOfBirth !== undefined
              ? {
                  dateOfBirth:
                    dateOfBirth === null
                      ? null
                      : new Date(dateOfBirth + "T00:00:00.000Z"),
                }
              : {}),
            verifiedAt: now,
          },
        });
        await saveEvidence("profile", evidence);
        for (const field of Object.keys(patch.profile).filter(
          (key) => key !== "evidence",
        ))
          await saveEvidence("profile." + field, undefined);
      }
      if (patch.skills) {
        for (const skillId of patch.skills.remove ?? []) {
          const removed = await tx.resumeSkill.deleteMany({
            where: { resumeId, skillId },
          });
          if (!removed.count)
            throw new CandidateDataError(
              404,
              "Skill association not found on this resume.",
            );
        }
        for (const input of patch.skills.upsert ?? []) {
          const skill = await resolveSkill(tx, input);
          const data = {
            originalText: input.originalText,
            context: input.context,
            verifiedAt: now,
          };
          await tx.resumeSkill.upsert({
            where: { resumeId_skillId: { resumeId, skillId: skill.id } },
            create: { resumeId, skillId: skill.id, ...data },
            update: data,
          });
          await saveEvidence("skills." + skill.id, input.evidence);
          if (input.originalText)
            await saveEvidence("skills." + skill.id + ".originalText", [
              { text: input.originalText, sourceSection: "skills" },
            ]);
        }
        if ((await tx.resumeSkill.count({ where: { resumeId } })) > 100)
          throw new CandidateDataError(422, "At most 100 candidate skills.");
      }
      for (const section of [
        "employment",
        "education",
        "projects",
        "certifications",
        "links",
        "additional",
      ] as const) {
        const changes = patch[section];
        if (!changes) continue;
        const delegate = store(tx, section);
        const records = await delegate.findMany({ where: { resumeId } });
        const byId = new Map(records.map((r) => [r.id, r]));
        for (const entryId of changes.remove ?? []) {
          if (!byId.has(entryId))
            throw new CandidateDataError(
              404,
              "Entry not found on this resume.",
            );
          await delegate.deleteMany({ where: { id: entryId, resumeId } });
          byId.delete(entryId);
        }
        // Reserve temporary positions so swapping existing entries is atomic.
        const moving =
          changes.upsert?.filter(
            (item) =>
              item.id && "position" in item && item.position !== undefined,
          ) ?? [];
        for (let i = 0; i < moving.length; i++)
          await delegate.updateMany({
            where: { id: moving[i].id!, resumeId },
            data: { position: -(i + 1) },
          });
        const used = new Set(
          [...byId.values()]
            .filter((r) => !moving.some((m) => m.id === r.id))
            .flatMap((r) => (r.position == null ? [] : [r.position])),
        );
        for (const item of changes.upsert ?? []) {
          const entryId = item.id;
          if (entryId && !byId.has(entryId))
            throw new CandidateDataError(
              404,
              "Entry not found on this resume.",
            );
          const data = relationalData(item as Record<string, unknown>);
          if (section !== "links") {
            if (data.position === undefined) {
              if (entryId) data.position = byId.get(entryId)!.position;
              else {
                let position = used.size ? Math.max(...used) + 1 : 0;
                if (position > 499)
                  position =
                    Array.from({ length: 500 }, (_, i) => i).find(
                      (i) => !used.has(i),
                    ) ?? 500;
                data.position = position;
              }
            }
            if (
              Number(data.position) > 499 ||
              (used.has(Number(data.position)) &&
                (!entryId || byId.get(entryId)?.position !== data.position))
            )
              throw new CandidateDataError(409, "Entry position is occupied.");
            used.add(Number(data.position));
          }
          if (
            (!entryId && section === "links" && (!data.type || !data.url)) ||
            (!entryId && section === "additional" && !data.type)
          )
            throw new CandidateDataError(
              422,
              "Entry type and required URL are missing.",
            );
          const merged = { ...byId.get(entryId ?? ""), ...data };
          for (const [start, end] of section === "certifications"
            ? [["issue", "expiry"]]
            : [["start", "end"]]) {
            for (const part of ["Year", "Month", "Day"]) {
              const first = (merged as Record<string, unknown>)[start + part],
                last = (merged as Record<string, unknown>)[end + part];
              if (first == null || last == null || Number(first) < Number(last))
                break;
              if (Number(first) > Number(last))
                throw new CandidateDataError(
                  422,
                  "End date precedes start date.",
                );
            }
          }
          if (
            section === "employment" &&
            merged.isCurrent === true &&
            (merged.endYear != null || merged.endText != null)
          )
            throw new CandidateDataError(
              422,
              "Current employment cannot have an end date.",
            );
          data.verifiedAt = now;
          let savedId = entryId;
          if (entryId)
            await delegate.updateMany({
              where: { id: entryId, resumeId },
              data,
            });
          else
            savedId = (await delegate.create({ data: { ...data, resumeId } }))
              .id;
          if (
            section === "projects" &&
            "skills" in item &&
            item.skills !== undefined
          ) {
            // This explicit project-skills field replaces only that project's associations.
            await tx.projectSkill.deleteMany({
              where: { projectId: savedId! },
            });
            for (const input of item.skills) {
              const skill = await resolveSkill(tx, input);
              await tx.projectSkill.upsert({
                where: {
                  projectId_skillId: { projectId: savedId!, skillId: skill.id },
                },
                create: { projectId: savedId!, skillId: skill.id },
                update: {},
              });
            }
          }
          await saveEvidence(section + "." + savedId, item.evidence);
          for (const field of Object.keys(item).filter(
            (key) => !["id", "evidence", "position"].includes(key),
          ))
            await saveEvidence(
              section + "." + savedId + "." + field,
              undefined,
            );
        }
        if ((await delegate.findMany({ where: { resumeId } })).length > 100)
          throw new CandidateDataError(422, "At most 100 entries per section.");
      }
      return { revision: patch.expectedRevision + 1 };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new CandidateDataError(
        409,
        "Candidate entry or skill changed; reload before editing.",
      );
    throw error;
  }
}
