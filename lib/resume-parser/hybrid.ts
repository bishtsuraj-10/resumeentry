import { candidatePatchSchema, safeUrlSchema } from "../candidate-validation";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";
import { extractStructuredResume, type StructuredExtraction } from "./index";
import { detectSections } from "./section-detector";
import { normalizeText } from "./text-normalizer";
import { jobTitle } from "./basic";
import { parseDate, dateRange } from "./validators/dates";
import { NuExtractAdapter, nuSchemas, type NuTarget } from "./ollama-nuextract";
import type { NuRequestLifecycle, NuOutcome } from "./ollama-nuextract";
import {
  suspiciousTargets,
  resumeHeading,
  contaminatedSkill,
  industrialAws,
} from "./suspicious";

export interface SourceChunk {
  text: string;
  start: number;
  end: number;
}
export interface HybridDiagnostic {
  target: string;
  state: "source-supported" | "invalid" | "conflict" | "unknown";
  reason: string;
}
export interface HybridResult {
  structured: StructuredExtraction;
  diagnostics: HybridDiagnostic[];
  metrics: {
    calls: number;
    requests: number;
    targets: NuTarget[];
    accepted: number;
    rejected: number;
    latencyMs: number;
    failures: string[];
    returnedValues: number;
    nullValues: number;
    emptyResponses: number;
  };
}
export function sourceChunks(
  text: string,
  maxChars: number,
  overlap = 400,
): SourceChunk[] {
  if (maxChars < 200 || overlap < 0 || overlap >= maxChars)
    throw new Error("INVALID_CHUNK_BUDGET");
  const result: SourceChunk[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + maxChars / 2) end = boundary;
    }
    result.push({ text: text.slice(start, end), start, end });
    if (end === text.length) break;
    start = end - Math.min(overlap, Math.floor((end - start) / 3));
  }
  return result;
}
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Return original offsets, never offsets into a normalized surrogate document.
export function sourceSpan(source: string, value: string) {
  const expression = value.trim().split(/\s+/).map(escaped).join("\\s+");
  if (!expression) return null;
  const pattern = new RegExp(expression, "giu");
  for (const match of source.matchAll(pattern)) {
    const start = match.index!,
      end = start + match[0].length;
    if (
      /\p{L}|\p{N}/u.test(value[0]) &&
      /[\p{L}\p{N}]/u.test(source[start - 1] ?? "")
    )
      continue;
    if (
      /[\p{L}\p{N}]/u.test(value.at(-1) ?? "") &&
      /[\p{L}\p{N}]/u.test(source[end] ?? "")
    )
      continue;
    return { start, end, text: match[0] };
  }
  return null;
}
function sourceContext(text: string, start: number, end: number) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const lineNumber = text.slice(0, start).split("\n").length;
  const section =
    detectSections(normalizeText(text)).find((l) => l.line === lineNumber)
      ?.section ?? "unknown";
  return { line, section, lineNumber };
}
export function fallbackTargets(result: StructuredExtraction): NuTarget[] {
  const c = result.candidate,
    b = result.basic;
  const targets: NuTarget[] = [];
  if (!b.name || !b.email || !b.phone) targets.push("identity");
  if (
    !b.designation ||
    !c.profile?.locationText ||
    !c.profile?.summary ||
    /[@|]|\b(?:phone|email)\s*:/i.test(c.profile.locationText) ||
    result.warnings.includes("INVALID_PROFILE_FIELDS")
  )
    targets.push("professional");
  if (
    !c.employment?.upsert?.length ||
    c.employment.upsert.some(
      (e) =>
        !e.employer ||
        !e.designation ||
        !e.startDate ||
        (!e.isCurrent && !e.endDate),
    ) ||
    result.warnings.some((w) => /EMPLOY/.test(w))
  )
    targets.push("employment");
  if (
    !c.skills?.upsert?.length ||
    !c.links?.upsert?.length ||
    result.warnings.includes("LAYOUT_READING_ORDER_UNCERTAIN")
  )
    targets.push("skillsLinks");
  if (
    !c.education?.upsert?.length ||
    c.education.upsert.some((e) => !e.degree || !e.institution) ||
    !c.certifications?.upsert?.length ||
    result.warnings.includes("UNRESOLVED_EDUCATION")
  )
    targets.push("education");
  return [...new Set([...suspiciousTargets(result), ...targets])];
}
function targetChunks(text: string, target: NuTarget, max: number) {
  const chunks = sourceChunks(text, max, Math.min(400, Math.floor(max / 4)));
  const desired =
    target === "employment"
      ? ["employment", "internships"]
      : target === "education"
        ? ["education", "certifications"]
        : target === "skillsLinks"
          ? ["skills", "personal", "header"]
          : target === "identity"
            ? ["header", "personal"]
            : ["header", "summary", "employment"];
  const raw = text.split("\n");
  const offsets = [0];
  for (let i = 0; i < raw.length; i++)
    offsets.push(offsets[i] + raw[i].length + 1);
  const lines = detectSections(normalizeText(text)).filter((l) =>
    desired.includes(l.section),
  );
  const scored = chunks.map((chunk) => ({
    chunk,
    score: lines.filter(
      (l) =>
        offsets[l.line - 1] >= chunk.start && offsets[l.line - 1] < chunk.end,
    ).length,
  }));
  // Prefer reliable sections but retain bounded original-order fallback windows.
  const selected = scored.some((c) => c.score)
    ? scored.filter((c) => c.score)
    : scored;
  return selected.map((c) => c.chunk);
}
export function mergeNuProposal(
  result: StructuredExtraction,
  text: string,
  chunk: SourceChunk,
  target: NuTarget,
  proposal: Record<string, unknown>,
): {
  result: StructuredExtraction;
  diagnostics: HybridDiagnostic[];
  accepted: number;
  rejected: number;
} {
  const next = structuredClone(result),
    diagnostics: HybridDiagnostic[] = [];
  let accepted = 0,
    rejected = 0;
  const diagnostic = (
    field: string,
    state: HybridDiagnostic["state"],
    reason: string,
  ) => {
    if (state === "invalid" || state === "conflict") rejected++;
    diagnostics.push({ target: field, state, reason });
  };
  // The adapter validates the complete response; retain a strict boundary for
  // callers that use this pure merge function with field-specific proposals.
  const checked = nuSchemas[target].partial().safeParse(proposal);
  if (!checked.success) {
    diagnostic(target, "invalid", "SCHEMA_REJECTED");
    return { result, diagnostics, accepted: 0, rejected };
  }
  proposal = checked.data;
  const proof = (
    fieldPath: string,
    value: string,
    scope: SourceChunk = chunk,
  ) => {
    const span = sourceSpan(scope.text, value);
    if (!span) return false;
    const start = scope.start + span.start;
    const context = sourceContext(text, start, start + span.text.length);
    next.evidence.push({
      fieldPath,
      text: span.text.slice(0, 500),
      sourceSection: context.section,
      confidence: 0,
      location: {
        page: text.slice(0, start).split("\f").length,
        lineStart: context.lineNumber,
        lineEnd: context.lineNumber + span.text.split("\n").length - 1,
      },
      signals: [
        "LOCAL_NUEXTRACT",
        "VERBATIM_SOURCE_MATCH",
        `SOURCE_OFFSET_${start}_${start + span.text.length}`,
        "REQUIRES_HUMAN_REVIEW",
      ],
    });
    return true;
  };
  const scalar = (field: string, value: unknown) => {
    if (value == null) return diagnostic(field, "unknown", "NULL_OR_ABSENT_VALUE");
    if (typeof value !== "string" || !sourceSpan(chunk.text, value))
      return diagnostic(field, "invalid", "NO_SOURCE_MATCH");
    const span = sourceSpan(chunk.text, value)!;
    const context = sourceContext(
      text,
      chunk.start + span.start,
      chunk.start + span.end,
    );
    let canonical = value;
    if (field.startsWith("basic.") || field === "profile.locationText") {
      if (
        ["references", "projects", "education", "certifications"].includes(
          context.section,
        ) ||
        /\b(?:client|recruiter|referee|employer contact|company email)\s*:/i.test(
          context.line,
        )
      )
        return diagnostic(field, "invalid", "UNSUPPORTED_OWNERSHIP");
    }
    if (
      [
        "basic.name",
        "basic.email",
        "basic.phone",
        "profile.locationText",
      ].includes(field) &&
      !["header", "personal"].includes(context.section)
    )
      return diagnostic(field, "invalid", "CONTACT_OUTSIDE_CANDIDATE_CONTEXT");
    if (
      field === "basic.name" &&
      (resumeHeading(value) ||
        !/^[\p{L} .'-]+$/u.test(value) ||
        jobTitle(value) ||
        context.line
          .split(/[|\t]/)[0]
          .replace(/^(?:full name|name)\s*:\s*/i, "")
          .trim()
          .toLowerCase() !== value.trim().toLowerCase())
    )
      return diagnostic(field, "invalid", "INVALID_NAME");
    if (field === "basic.email") {
      if (!z.string().email().safeParse(value).success)
        return diagnostic(field, "invalid", "INVALID_EMAIL");
      canonical = value.toLowerCase();
    }
    if (field === "basic.phone") {
      const phone = value.startsWith("+")
        ? parsePhoneNumberFromString(value)
        : null;
      if (!phone?.isValid())
        return diagnostic(field, "invalid", "UNRESOLVED_PHONE_COUNTRY");
      canonical = phone.formatInternational();
    }
    if (field === "basic.designation") {
      const owned = context.line
        .replace(/^(?:designation|job title|role)\s*:\s*/i, "")
        .trim();
      if (
        /\bchartered engineer\b/i.test(value) ||
        /^(?:client|reference|recruiter|desired|seeking|reporting to|as|worked as)\b/i.test(
          owned,
        ) ||
        !jobTitle(value) ||
        !owned.toLowerCase().startsWith(value.toLowerCase()) ||
        !["header", "employment"].includes(context.section)
      )
        return diagnostic(field, "invalid", "UNSUPPORTED_CURRENT_ROLE");
      if (context.section === "employment") {
        const window = text.slice(
          chunk.start + span.start,
          Math.min(chunk.start + span.end + 250, chunk.end),
        );
        if (!dateRange(window)?.isCurrent)
          return diagnostic(field, "invalid", "CURRENT_ROLE_NOT_ESTABLISHED");
      }
      if (
        context.section === "header" &&
        detectSections(normalizeText(text)).some(
          (l) => l.section === "employment" && dateRange(l.text)?.isCurrent,
        ) &&
        !next.candidate.employment?.upsert?.some(
          (e) =>
            e.isCurrent && e.designation?.toLowerCase() === value.toLowerCase(),
        )
      )
        return diagnostic(
          field,
          "invalid",
          "CURRENT_EMPLOYMENT_OWNERSHIP_UNRESOLVED",
        );
    }
    if (
      field === "profile.locationText" &&
      (/[@|\t]|\b(?:phone|email|mobile)\s*:/i.test(value) ||
        (!/^(?:location|address|based in)\s*:/i.test(context.line) &&
          !/^[\p{L} .'-]+,\s*[\p{L} .'-]+$/u.test(value)))
    )
      return diagnostic(field, "invalid", "UNSUPPORTED_LOCATION");
    if (
      field === "profile.summary" &&
      (context.section !== "summary" ||
        /^(?:project(?: name| title| description)?|client)\s*:/im.test(value))
    )
      return diagnostic(
        field,
        "invalid",
        "NO_SUMMARY_SECTION_OR_AMBIGUOUS_OWNER",
      );
    const [section, key] = field.split(".");
    const existing =
      section === "basic"
        ? (next.basic as unknown as Record<string, unknown>)[key]
        : (next.candidate.profile as Record<string, unknown> | undefined)?.[
            key
          ];
    if (existing != null) {
      if (
        String(existing).trim().toLowerCase() !== canonical.trim().toLowerCase()
      )
        diagnostic(field, "conflict", "PRESERVED_EXISTING_VALUE");
      else diagnostic(field, "source-supported", "ALREADY_EXTRACTED");
      return;
    }
    if (section === "basic") {
      const parsed = candidatePatchSchema.safeParse({
        expectedRevision: 0,
        basic: { [key]: canonical },
      });
      if (!parsed.success)
        return diagnostic(field, "invalid", "CANDIDATE_SCHEMA_REJECTED");
      Object.assign(next.basic, { [key]: canonical });
      if (key === "phone") {
        const phone = parsePhoneNumberFromString(canonical)!;
        Object.assign(next.basic, {
          normalizedPhone: phone.number,
          countryCode: "+" + phone.countryCallingCode,
        });
      }
    } else {
      const profile = { ...next.candidate.profile, [key]: canonical };
      if (
        !candidatePatchSchema.safeParse({ expectedRevision: 0, profile })
          .success
      )
        return diagnostic(field, "invalid", "CANDIDATE_SCHEMA_REJECTED");
      next.candidate.profile = profile;
    }
    proof(field, value);
    accepted++;
    diagnostic(field, "source-supported", "ADDED_FOR_MANUAL_REVIEW");
  };
  if (target === "professional") {
    scalar("basic.designation", proposal.current_designation);
    scalar("profile.locationText", proposal.location);
    scalar("profile.summary", proposal.summary);
  }
  if (target === "identity")
    for (const key of ["name", "email", "phone"])
      scalar("basic." + key, proposal[key]);
  if (target === "skillsLinks") {
    for (const key of ["skills", "links"] as const)
      for (const value of (proposal[key] as (string | null)[]) ?? []) {
        if (!value) continue;
        const span = sourceSpan(chunk.text, value);
        if (!span) {
          diagnostic(key, "invalid", "NO_SOURCE_MATCH");
          continue;
        }
        const context = sourceContext(
          text,
          chunk.start + span.start,
          chunk.start + span.end,
        );
        if (
          key === "skills" &&
          /^AWS$/i.test(value) &&
          industrialAws(context.line)
        ) {
          diagnostic(key, "invalid", "AMBIGUOUS_AWS_CONTEXT");
          continue;
        }
        if (
          (key === "skills" && context.section !== "skills") ||
          (key === "links" && !["header", "personal"].includes(context.section))
        ) {
          diagnostic(key, "invalid", "UNSUPPORTED_OWNERSHIP");
          continue;
        }
        const entry =
          key === "skills"
            ? { name: value }
            : {
                url: /^https?:/i.test(value) ? value : "https://" + value,
                type: "OTHER" as const,
              };
        if (
          key === "skills" &&
          (contaminatedSkill(value) ||
            value.length > 120 ||
            /[!?]|\b(?:and|with|using)\s*$/i.test(value))
        ) {
          diagnostic(key, "invalid", "MALFORMED_SKILL");
          continue;
        }
        if (
          key === "links" &&
          !safeUrlSchema.safeParse((entry as { url: string }).url).success
        ) {
          diagnostic(key, "invalid", "INVALID_LINK");
          continue;
        }
        const items = next.candidate[key]?.upsert ?? [];
        if (
          items.some(
            (i) =>
              ("name" in i ? i.name : i.url)?.toLowerCase() ===
              (key === "skills"
                ? value
                : (entry as { url: string }).url
              ).toLowerCase(),
          )
        ) {
          diagnostic(key, "source-supported", "ALREADY_EXTRACTED");
          continue;
        }
        const changes = { upsert: [...items, entry] };
        if (
          !candidatePatchSchema.safeParse({
            expectedRevision: 0,
            [key]: changes,
          }).success
        ) {
          diagnostic(key, "invalid", "CANDIDATE_SCHEMA_REJECTED");
          continue;
        }
        Object.assign(next.candidate, { [key]: changes });
        proof(
          `${key}.${items.length}.${key === "skills" ? "name" : "url"}`,
          value,
        );
        accepted++;
        diagnostic(key, "source-supported", "ADDED_FOR_MANUAL_REVIEW");
      }
  }
  for (const section of target === "employment"
    ? (["employment"] as const)
    : target === "education"
      ? (["education", "certifications"] as const)
      : []) {
    for (const record of (proposal[section] as Record<
      string,
      string | null
    >[]) ?? []) {
      const quote = record.source_quote;
      if (
        !quote ||
        quote.length > 1000 ||
        quote.split("\n").length > 6 ||
        !sourceSpan(chunk.text, quote)
      ) {
        diagnostic(section, "invalid", "NO_LOCAL_RELATIONSHIP_QUOTE");
        continue;
      }
      const quoteSpan = sourceSpan(chunk.text, quote)!;
      const context = sourceContext(
        text,
        chunk.start + quoteSpan.start,
        chunk.start + quoteSpan.end,
      );
      const allowed =
        section === "employment" ? ["employment", "internships"] : [section];
      const components = Object.entries(record).filter(
        ([k, v]) => k !== "source_quote" && v != null,
      );
      if (
        section === "education" &&
        /^MS$/i.test(record.degree ?? "") &&
        /\bMS\s+(?:Office|Projects?|Excel|Word|Windows)\b/i.test(quote)
      ) {
        diagnostic(section, "invalid", "SOFTWARE_IS_NOT_A_DEGREE");
        continue;
      }
      if (
        !allowed.includes(context.section) ||
        components.some(([, v]) => !sourceSpan(quote, v!))
      ) {
        diagnostic(section, "invalid", "UNSUPPORTED_RELATIONSHIP");
        continue;
      }
      const dates = record.start_date ? parseDate(record.start_date) : null;
      const current = /^(?:present|current|now)$/i.test(record.end_date ?? "");
      const end =
        record.end_date && !current ? parseDate(record.end_date) : null;
      if (section === "employment") {
        if (
          /\b(?:client|project)\s*:/i.test(quote) &&
          !/\b(?:employer|company|organization)\s*:/i.test(quote)
        ) {
          diagnostic(section, "invalid", "AMBIGUOUS_EMPLOYER_CLIENT");
          continue;
        }
        const range = dateRange(quote);
        const sameDate = (a: typeof dates, b: typeof dates) =>
          JSON.stringify([a?.year, a?.month]) ===
          JSON.stringify([b?.year, b?.month]);
        if (
          !range ||
          !sameDate(range.startDate, dates) ||
          !sameDate(range.endDate, end) ||
          range.isCurrent !== current ||
          dateRange(quote.replace(range.matched, ""))
        ) {
          diagnostic(section, "invalid", "AMBIGUOUS_DATE_RELATIONSHIP");
          continue;
        }
      }
      if (
        section === "employment" &&
        (!record.employer ||
          !record.designation ||
          !dates ||
          !record.end_date ||
          (!current && !end))
      ) {
        diagnostic(section, "invalid", "INCOMPLETE_EMPLOYMENT_TUPLE");
        continue;
      }
      if (
        dates?.day ||
        end?.day ||
        (record.start_date && !dates) ||
        (record.end_date && !current && !end)
      ) {
        diagnostic(section, "invalid", "UNSUPPORTED_DATE_PRECISION");
        continue;
      }
      const items = next.candidate[section]?.upsert ?? [];
      const ownershipKey =
        section === "employment"
          ? "employer"
          : section === "education"
            ? "institution"
            : "name";
      if (
        items.some(
          (item) =>
            String(
              (item as Record<string, unknown>)[ownershipKey] ?? "",
            ).toLowerCase() === (record[ownershipKey] ?? "").toLowerCase(),
        )
      ) {
        diagnostic(
          section,
          "conflict",
          "EXISTING_OR_INCOMPLETE_RECORD_PRESERVED",
        );
        continue;
      }
      const entry =
        section === "employment"
          ? {
              position: items.length,
              employer: record.employer,
              designation: record.designation,
              startDate: dates,
              endDate: end,
              isCurrent: current,
            }
          : section === "education"
            ? {
                position: items.length,
                degree: record.degree,
                institution: record.institution,
                startDate: dates,
                endDate: end,
              }
            : {
                position: items.length,
                name: record.name,
                issuer: record.issuer,
              };
      if (
        (section === "education" && (!record.degree || !record.institution)) ||
        (section === "certifications" && !record.name)
      ) {
        diagnostic(section, "invalid", "INCOMPLETE_RECORD");
        continue;
      }
      const changes = { upsert: [...items, entry] };
      if (
        !candidatePatchSchema.safeParse({
          expectedRevision: 0,
          [section]: changes,
        }).success
      ) {
        diagnostic(section, "invalid", "CANDIDATE_SCHEMA_REJECTED");
        continue;
      }
      Object.assign(next.candidate, { [section]: changes });
      const recordScope = {
        text: quoteSpan.text,
        start: chunk.start + quoteSpan.start,
        end: chunk.start + quoteSpan.end,
      };
      for (const [field, v] of components)
        proof(
          `${section}.${items.length}.${field === "start_date" ? "startDate" : field === "end_date" ? "endDate" : field}`,
          v!,
          recordScope,
        );
      accepted++;
      diagnostic(section, "source-supported", "ADDED_FOR_MANUAL_REVIEW");
    }
  }
  // Preserve all local confidence values, including zero for recovered identity.
  // Experimental source matches are not calibrated correctness probabilities.
  next.warnings = [
    ...new Set([...next.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
  ];
  if (
    Object.keys(next.candidate).length &&
    !candidatePatchSchema.safeParse({ expectedRevision: 0, ...next.candidate })
      .success
  ) {
    diagnostic(target, "invalid", "MERGE_CONTRACT_OR_BUDGET_REJECTED");
    return {
      result: {
        ...result,
        warnings: [
          ...new Set([...result.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
        ],
      },
      diagnostics: diagnostics.map((d) =>
        d.state === "source-supported"
          ? {
              ...d,
              state: "conflict" as const,
              reason: "VERIFIED_BUT_MERGE_ROLLED_BACK",
            }
          : d,
      ),
      accepted: 0,
      rejected: rejected + accepted,
    };
  }
  return { result: next, diagnostics, accepted, rejected };
}
export async function extractHybridResume(
  text: string,
  options: {
    baseline?: StructuredExtraction;
    adapter?: NuExtractAdapter;
    signal?: AbortSignal;
    targets?: NuTarget[];
    asOf?: Date;
    documentWarnings?: string[];
    protectedCandidate?: boolean;
    requestLifecycle?: NuRequestLifecycle;
    onOutcome?: (outcome: NuOutcome, target: NuTarget) => Promise<void> | void;
  } = {},
): Promise<HybridResult> {
  let structured = options.baseline ?? extractStructuredResume(text, options);
  const diagnostics: HybridDiagnostic[] = [];
  const metrics: HybridResult["metrics"] = {
    calls: 0,
    requests: 0,
    targets: [],
    accepted: 0,
    rejected: 0,
    latencyMs: 0,
    failures: [],
    returnedValues: 0,
    nullValues: 0,
    emptyResponses: 0,
  };
  if (options.protectedCandidate)
    return {
      structured,
      diagnostics: [
        {
          target: "candidate",
          state: "unknown",
          reason: "PROTECTED_CANDIDATE_UNCHANGED",
        },
      ],
      metrics,
    };
  let adapter: NuExtractAdapter;
  try {
    adapter = options.adapter ?? new NuExtractAdapter();
  } catch {
    return {
      structured: {
        ...structured,
        warnings: [
          ...new Set([...structured.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
        ],
      },
      diagnostics: [
        {
          target: "adapter",
          state: "unknown",
          reason: "INVALID_LOCAL_MODEL_CONFIG",
        },
      ],
      metrics,
    };
  }
  if (!adapter.config.enabled) return { structured, diagnostics, metrics };
  const deadline = Date.now() + adapter.config.documentBudgetMs;
  const max = Math.min(
    adapter.config.maxInputChars,
    (adapter.config.contextTokens - adapter.config.outputTokens - 512) * 2,
  );
  const plans = (options.targets ?? fallbackTargets(structured)).map(
    (target) => ({ target, chunks: targetChunks(text, target, max) }),
  );
  // Round-robin targets before revisiting chunks, to avoid one long section
  // consuming every call. Each target's windows retain document order.
  outer: for (let index = 0; index < 4; index++)
    for (const { target, chunks } of plans) {
      const chunk = chunks[index];
      if (!chunk) continue;
      if (
        metrics.calls >= adapter.config.maxCalls ||
        Date.now() >= deadline ||
        options.signal?.aborted
      ) {
        diagnostics.push({
          target,
          state: "unknown",
          reason: "DOCUMENT_BUDGET_OR_ABORT",
        });
        break outer;
      }
      metrics.calls++;
      metrics.targets.push(target);
      const outcome = await adapter.extract(
        target,
        chunk.text,
        options.signal,
        deadline - Date.now(),
        options.requestLifecycle,
      );
      await options.onOutcome?.(outcome, target);
      if (outcome.invoked) metrics.requests++;
      metrics.latencyMs += outcome.latencyMs;
      if (!outcome.ok) {
        metrics.failures.push(outcome.reason);
        diagnostics.push({ target, state: "unknown", reason: outcome.reason });
        // No retry of an impossible, malformed, unavailable or timed-out request.
        break outer;
      }
      // Only counts cross the diagnostic boundary; never retain response values.
      const countValues = (value: unknown): void => {
        if (value == null) metrics.nullValues++;
        else if (typeof value === "string" && value.trim()) metrics.returnedValues++;
        else if (Array.isArray(value)) value.forEach(countValues);
        else if (typeof value === "object") Object.entries(value).forEach(([key, item]) => {
          if (key !== "source_quote") countValues(item);
        });
      };
      const priorValues = metrics.returnedValues;
      countValues(outcome.data);
      if (priorValues === metrics.returnedValues) {
        metrics.emptyResponses++;
        diagnostics.push({ target, state: "unknown", reason: "NO_POPULATED_MODEL_VALUES" });
      }
      const merged = mergeNuProposal(
        structured,
        text,
        chunk,
        target,
        outcome.data,
      );
      structured = merged.result;
      metrics.accepted += merged.accepted;
      metrics.rejected += merged.rejected;
      diagnostics.push(...merged.diagnostics);
      if (!merged.diagnostics.length)
        diagnostics.push({
          target,
          state: "unknown",
          reason: "NO_NEW_VERIFIED_VALUES",
        });
    }
  if (metrics.calls)
    structured = {
      ...structured,
      warnings: [
        ...new Set([...structured.warnings, "EXPERIMENTAL_HYBRID_REVIEW"]),
      ],
      parserVersion: structured.parserVersion + "+nuextract-experimental",
    };
  return { structured, diagnostics, metrics };
}
