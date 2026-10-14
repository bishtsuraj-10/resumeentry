import type { Prisma } from "@prisma/client";
import type { candidateInclude } from "./candidate-data";

type Serialized<T> = T extends Date
  ? string
  : T extends bigint
    ? number
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
export type CandidateView = Serialized<
  Prisma.CandidateProfileGetPayload<{ include: typeof candidateInclude }>
>;
export type BasicView = Serialized<Prisma.ResumeExtractionGetPayload<object>>;
export type ResumeView = {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  extraction: BasicView | null;
  candidate: CandidateView | null;
  manualFields?: string[];
};
export type EvidenceView = {
  id: string;
  fieldPath: string;
  sourceSection: string | null;
  text: string | null;
  location: unknown;
  confidence: number | null;
  verifiedAt: string | null;
};
export type RunView = {
  id: string;
  method: string;
  parserVersion: string | null;
  startedAt: string;
  evidence: EvidenceView[];
  _count: { evidence: number };
};

export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`;
    if (
      data &&
      typeof data === "object" &&
      "issues" in data &&
      Array.isArray(data.issues)
    ) {
      const issues = data.issues.filter(
        (v): v is { path: string; message: string } =>
          typeof v === "object" &&
          v !== null &&
          typeof v.path === "string" &&
          typeof v.message === "string",
      );
      message += " " + issues.map((v) => `${v.path}: ${v.message}`).join("; ");
    }
    throw new Error(
      response.status === 409
        ? `${message} Reload the candidate before trying again; your unsaved changes have been kept.`
        : message,
    );
  }
  if (!data || typeof data !== "object")
    throw new Error(
      "The server returned no usable data. Please reload and try again.",
    );
  options.signal?.throwIfAborted();
  return data as T;
}
export async function loadResume(
  id: string,
  signal: AbortSignal,
): Promise<ResumeView> {
  const result = await requestJson<ResumeView>(
    `/api/resumes/${encodeURIComponent(id)}`,
    { signal },
  );
  if (
    typeof result.id !== "string" ||
    typeof result.fileName !== "string" ||
    typeof result.status !== "string" ||
    typeof result.fileType !== "string"
  )
    throw new Error(
      "The server returned an incomplete resume record. Please reload and try again.",
    );
  if (
    result.candidate &&
    [
      "skills",
      "employment",
      "education",
      "projects",
      "certifications",
      "links",
      "additional",
      "additionalEmails",
      "employmentPreferences",
    ].some(
      (key) =>
        !Array.isArray(
          (result.candidate as unknown as Record<string, unknown>)[key],
        ),
    )
  )
    throw new Error(
      "The server returned an incomplete candidate profile. Please reload and try again.",
    );
  return result;
}
export function experienceLabel(months: number | null | undefined) {
  if (months == null) return "Not identified";
  const years = Math.floor(months / 12),
    remainder = months % 12;
  return (
    [years ? `${years}y` : "", remainder ? `${remainder}m` : ""]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}
export function dateLabel(item: object, prefix: string): string {
  const parts = item as Record<string, unknown>;
  const year = parts[prefix + "Year"],
    month = parts[prefix + "Month"],
    day = parts[prefix + "Day"];
  return year != null
    ? [
        year,
        month != null ? String(month).padStart(2, "0") : null,
        day != null ? String(day).padStart(2, "0") : null,
      ]
        .filter((v) => v != null)
        .join("-")
    : String(parts[prefix + "Text"] ?? "Not identified");
}
export function safeLink(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
// Return only changed keys. Unchanged fields must not acquire human verification.
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(before[key] ?? null),
    ),
  );
}
