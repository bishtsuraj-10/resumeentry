import { Prisma } from "@prisma/client";
import {
  normalizeSkillName,
  type PartialCandidateDate,
} from "../candidate-validation";
import type { StructuredExtraction } from "./index";
type Tx = Prisma.TransactionClient;
function dateFields(
  prefix: string,
  value: PartialCandidateDate | null | undefined,
) {
  return Object.fromEntries(
    ["Year", "Month", "Day", "Text"].map((part) => [
      prefix + part,
      value?.[part.toLowerCase() as keyof PartialCandidateDate] ?? null,
    ]),
  );
}
function dataFields(input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (["id", "position", "evidence", "skills"].includes(key)) continue;
    const prefix = (
      {
        startDate: "start",
        endDate: "end",
        issueDate: "issue",
        expiryDate: "expiry",
      } as Record<string, string>
    )[key];
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
  input: {
    name: string;
    aliases?: string[];
    category?: string | null;
  },
) {
  const normalizedName = normalizeSkillName(input.name);
  const term = await tx.skillTerm.findUnique({
    where: { normalizedName },
    include: { skill: true },
  });
  let skill = term?.skill;
  if (!skill) {
    // Atomic upsert avoids duplicate taxonomy creation across candidate workers.
    skill = await tx.skill.upsert({
      where: { normalizedName },
      create: {
        canonicalName: input.name,
        normalizedName,
        category: input.category,
      },
      update: {},
    });
    const canonical = await tx.skillTerm.upsert({
      where: { normalizedName },
      create: { normalizedName, displayName: input.name, skillId: skill.id },
      update: {},
    });
    if (canonical.skillId !== skill.id)
      skill = await tx.skill.findUniqueOrThrow({
        where: { id: canonical.skillId },
      });
  }
  for (const alias of input.aliases ?? []) {
    const key = normalizeSkillName(alias);
    // Respect a human-curated alias: machine parsing cannot reassign or reclassify it.
    await tx.skillTerm.upsert({
      where: { normalizedName: key },
      create: { normalizedName: key, displayName: alias, skillId: skill.id },
      update: {},
    });
  }
  return skill;
}
// Called ONLY inside M1's successfully fenced finalization transaction.
// First-fill policy protects human edits AND deletion intent without guessing ownership.
export async function persistStructured(
  tx: Tx,
  resumeId: string,
  runId: string,
  result: StructuredExtraction,
) {
  const existing = await tx.candidateProfile.findUnique({
    where: { resumeId },
    select: { resumeId: true },
  });
  const observedOnly = Boolean(existing);
  const pathMap = new Map<string, string>();
  const candidate = result.candidate;
  const populated = Object.keys(candidate).length > 0;
  if (!existing && populated) {
    const {
      dateOfBirth,
      evidence: _evidence,
      ...profile
    } = candidate.profile ?? {};
    void _evidence;
    await tx.candidateProfile.create({
      data: {
        resumeId,
        revision: 1,
        ...profile,
        ...(dateOfBirth
          ? { dateOfBirth: new Date(dateOfBirth + "T00:00:00.000Z") }
          : {}),
        verifiedAt: null,
      },
    });
    for (const [index, input] of (candidate.skills?.upsert ?? []).entries()) {
      const skill = await resolveSkill(tx, input);
      const confidence =
        result.evidence.find((e) => e.fieldPath === `skills.${index}.name`)
          ?.confidence ?? null;
      await tx.resumeSkill.upsert({
        where: { resumeId_skillId: { resumeId, skillId: skill.id } },
        create: {
          resumeId,
          skillId: skill.id,
          originalText: input.originalText,
          context: input.context,
          confidence,
        },
        update: {},
      });
      pathMap.set(`skills.${index}`, `skills.${skill.id}`);
    }
    for (const section of [
      "employment",
      "education",
      "projects",
      "certifications",
      "links",
      "additional",
    ] as const) {
      for (const [index, input] of (
        candidate[section]?.upsert ?? []
      ).entries()) {
        const confidence =
          result.evidence.find((e) =>
            e.fieldPath.startsWith(`${section}.${index}.`),
          )?.confidence ?? null;
        const common = {
          resumeId,
          ...dataFields(input as Record<string, unknown>),
          ...(section !== "links" ? { position: index, confidence } : {}),
        };
        // Explicit delegates retain generated Prisma create types at this boundary.
        let record: {
          id: string;
        };
        switch (section) {
          case "employment":
            record = await tx.candidateEmployment.create({
              data: common as Prisma.CandidateEmploymentUncheckedCreateInput,
            });
            break;
          case "education":
            record = await tx.candidateEducation.create({
              data: common as Prisma.CandidateEducationUncheckedCreateInput,
            });
            break;
          case "projects":
            record = await tx.candidateProject.create({
              data: common as Prisma.CandidateProjectUncheckedCreateInput,
            });
            break;
          case "certifications":
            record = await tx.candidateCertification.create({
              data: common as Prisma.CandidateCertificationUncheckedCreateInput,
            });
            break;
          case "links":
            record = await tx.candidateLink.create({
              data: common as Prisma.CandidateLinkUncheckedCreateInput,
            });
            break;
          case "additional":
            record = await tx.candidateAdditional.create({
              data: common as Prisma.CandidateAdditionalUncheckedCreateInput,
            });
            break;
        }
        pathMap.set(`${section}.${index}`, `${section}.${record.id}`);
        if (section === "projects" && "skills" in input)
          for (const skillInput of input.skills ?? []) {
            const skill = await resolveSkill(tx, skillInput);
            await tx.projectSkill.upsert({
              where: {
                projectId_skillId: { projectId: record.id, skillId: skill.id },
              },
              create: { projectId: record.id, skillId: skill.id },
              update: {},
            });
          }
      }
    }
  }
  const proofs = result.evidence.map((e) => {
    let fieldPath = e.fieldPath;
    for (const [prefix, target] of pathMap)
      if (fieldPath.startsWith(prefix + ".")) {
        fieldPath = target + fieldPath.slice(prefix.length);
        break;
      }
    if (
      !fieldPath.startsWith("basic.") &&
      !fieldPath.startsWith("observed.") &&
      (observedOnly || !populated)
    )
      fieldPath = "observed." + fieldPath;
    // Signals are small rule identifiers, never document contents or paths.
    return {
      runId,
      fieldPath,
      sourceSection: e.sourceSection,
      text: e.text.slice(0, 500),
      confidence: e.confidence,
      location: { ...e.location, signals: e.signals },
    };
  });
  if (result.warnings.length)
    proofs.push({
      runId,
      fieldPath: "document.warnings",
      sourceSection: "document",
      text: result.warnings.join(", ").slice(0, 500),
      confidence: 0,
      location: {
        page: 1,
        lineStart: 1,
        lineEnd: 1,
        signals: ["REVIEW_REQUIRED"],
      },
    });
  if (proofs.length) await tx.candidateEvidence.createMany({ data: proofs });
}
