"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { dateLabel, safeLink } from "@/lib/resume-review";
import { fieldReviewState } from "@/lib/review-workspace";

export type Draft = { build: () => Record<string, unknown>; clear: () => void };
export type DraftHandler = (token: string, draft: Draft | null) => void;
export const VerificationContext = createContext<string[]>([]);
export type Field = {
  key: string;
  label: string;
  kind?: "number" | "array" | "date" | "boolean" | "json";
};
const textFields = (...keys: string[]): Field[] =>
  keys.map((key) => ({ key, label: key.replace(/([A-Z])/g, " $1") }));
export const identityFields = textFields("name", "email", "phone", "designation");
export const profileFields: Field[] = [
  ...textFields(
    "firstName",
    "lastName",
    "headline",
    "summary",
    "objective",
    "locationText",
    "city",
    "region",
    "country",
    "noticePeriod",
    "dateOfBirth",
  ),
  {
    key: "totalExperienceMonths",
    label: "Experience in months",
    kind: "number",
  },
  ...["employmentPreferences", "additionalEmails", "additionalPhones"].map(
    (key) => ({
      key,
      label: key.replace(/([A-Z])/g, " $1"),
      kind: "array" as const,
    }),
  ),
];
const dates: Field[] = [
  { key: "startDate", label: "Start date", kind: "date" },
  { key: "endDate", label: "End date", kind: "date" },
];
const bullets: Field[] = [
  { key: "responsibilities", label: "Responsibilities", kind: "array" },
  { key: "achievements", label: "Achievements", kind: "array" },
];
export const recordFields: Record<string, Field[]> = {
  employment: [
    ...textFields(
      "employer",
      "designation",
      "location",
      "employmentType",
      "description",
    ),
    ...dates,
    { key: "isCurrent", label: "Current employment", kind: "boolean" },
    ...bullets,
  ],
  education: [
    ...textFields(
      "degree",
      "fieldOfStudy",
      "institution",
      "location",
      "grade",
      "gradeScale",
      "description",
    ),
    ...dates,
  ],
  projects: [
    ...textFields("name", "role", "description", "url"),
    ...dates,
    ...bullets,
    { key: "skills", label: "Technologies", kind: "array" },
  ],
  certifications: [
    ...textFields("name", "issuer", "credentialId", "url"),
    { key: "issueDate", label: "Issue date", kind: "date" },
    { key: "expiryDate", label: "Expiry date", kind: "date" },
  ],
  links: textFields("url", "label", "type"),
  additional: [
    ...textFields("title", "type"),
    { key: "details", label: "Qualification details", kind: "json" },
  ],
  skills: textFields("context", "originalText"),
};
export type Patch = (changes: Record<string, unknown>) => Promise<boolean>;
function VerificationIndicator({ state }: { state: string }) {
  if (state.startsWith("Missing")) return null;
  const verified = state === "Manually verified";
  const uncertain = state === "Uncertain extraction";
  return <span className={"verification-indicator " + (verified ? "is-verified" : uncertain ? "is-uncertain" : "is-machine")} title={state} aria-label={state} role="img"><span aria-hidden="true">{verified ? "✓" : uncertain ? "!" : "·"}</span>{verified ? <span aria-hidden="true">Verified</span> : uncertain ? <span aria-hidden="true">Check source</span> : null}</span>;
}
function inputText(value: unknown, field: Field): string {
  if (value == null) return "";
  if (field.key === "dateOfBirth") return String(value).slice(0, 10);
  if (Array.isArray(value))
    return value
      .map((v) =>
        typeof v === "object" && v !== null && "normalizedPhone" in v
          ? v.normalizedPhone
          : v,
      )
      .join("\n");
  if (field.kind === "date" && typeof value === "object")
    return dateLabel(
      Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          "value" + k[0].toUpperCase() + k.slice(1),
          v,
        ]),
      ),
      "value",
    );
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}
export function storedValues(record: object): Record<string, unknown> {
  const values = { ...record } as Record<string, unknown>;
  for (const [key, prefix] of [
    ["startDate", "start"],
    ["endDate", "end"],
    ["issueDate", "issue"],
    ["expiryDate", "expiry"],
  ])
    if (values[prefix + "Year"] != null || values[prefix + "Text"] != null)
      values[key] = Object.fromEntries(
        ["year", "month", "day", "text"].map((k) => [
          k,
          values[prefix + k[0].toUpperCase() + k.slice(1)] ?? null,
        ]),
      );
  return values;
}
export function FieldEditor({
  section,
  record,
  fields,
  patch,
  busy,
  onDraft,
  token,
  manualFields,
}: {
  section: string;
  record: Record<string, unknown>;
  fields: Field[];
  patch: Patch;
  busy: boolean;
  onDraft: DraftHandler;
  token: string;
  manualFields: string[];
}) {
  const [key, setKey] = useState(fields[0].key),
    [value, setValue] = useState(inputText(record[fields[0].key], fields[0])),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const field = fields.find((f) => f.key === key)!;
  function build() {
    const text = (dirty ? value : inputText(record[key], field)).trim();
    let result: unknown = text || null;
    if (field.kind === "array")
      result = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (field.kind === "number") {
      result = text ? Number(text) : null;
      if (text && (!Number.isInteger(result) || Number(result) < 0))
        throw new Error("Use a nonnegative whole number of months.");
    }
    if (field.kind === "boolean") {
      if (!["true", "false", ""].includes(text))
        throw new Error("Use true, false, or an empty value.");
      result = text ? text === "true" : null;
    }
    if (field.kind === "date" && text) {
      const m = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
      if (!m)
        throw new Error(
          "Use YYYY, YYYY-MM or YYYY-MM-DD. Leave blank to clear the date.",
        );
      result = {
        year: Number(m[1]),
        ...(m[2] ? { month: Number(m[2]) } : {}),
        ...(m[3] ? { day: Number(m[3]) } : {}),
      };
    }
    if (field.kind === "json")
      result = text ? (JSON.parse(text) as unknown) : null;
    if (section === "projects" && key === "skills")
      result = (result as string[]).map((name) => ({ name }));
    const update = { [key]: result };
    return section === "basic" || section === "profile"
      ? { [section]: update }
      : {
          [section]: {
            upsert: [
              {
                ...(record.id ? { id: record.id } : {}),
                ...(section === "skills" ? { name: record.name } : {}),
                ...update,
              },
            ],
          },
        };
  }
  const latest = useRef<Draft | null>(null);
  useEffect(() => {
    latest.current = {
      build,
      clear: () => {
        setDirty(false);
        setError("");
      },
    };
  });
  useEffect(() => {
    onDraft(
      token,
      dirty
        ? {
            build: () => latest.current!.build(),
            clear: () => latest.current!.clear(),
          }
        : null,
    );
    return () => onDraft(token, null);
  }, [dirty, onDraft, token]);
  async function submit() {
    setError("");
    try {
      if (await patch(build())) {
        setDirty(false);
        onDraft(token, null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid field value.");
    }
  }
  return (
    <details className="candidate-editor">
      <summary>
        Edit{" "}
        {section === "basic"
          ? "identity"
          : section === "profile"
            ? "profile"
            : "record"}
        {dirty ? " · Unsaved" : ""}
      </summary>
      <dl className="candidate-field-register">
        {fields.map((f) => {
          const explicitlyVerified = manualFields.includes(token.split("|")[0] + "." + f.key);
          const state = section === "skills" && record.verifiedAt && !explicitlyVerified ? "Field verification detail unavailable" : fieldReviewState(
            record[f.key],
            explicitlyVerified,
            section === "basic"
              ? Number(record[f.key + "Confidence"] ?? 1)
              : (record.confidence as number | null),
          );
          return (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>
                {inputText(record[f.key], f) || "Not identified"}
                <VerificationIndicator state={state} />
                <button
                  type="button"
                  className="field-edit"
                  disabled={busy || dirty}
                  onClick={() => {
                    setKey(f.key);
                    setValue(inputText(record[f.key], f));
                    document.getElementById(token + "-value")?.focus();
                  }}
                >
                  Edit {f.label}
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
      <form action={submit} className="review-form">
        <label>
          Field
          <select
            className="tool-input"
            value={key}
            disabled={busy || dirty}
            onChange={(e) => {
              const f = fields.find((f) => f.key === e.target.value)!;
              setKey(f.key);
              setValue(inputText(record[f.key], f));
            }}
          >
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value
          <textarea
            className="tool-input"
            id={token + "-value"}
            name="value"
            value={dirty ? value : inputText(record[key], field)}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
            }}
            rows={4}
            disabled={busy}
          />
        </label>
        <p className="candidate-muted">
          Only the selected field is submitted and verified.{" "}
          {field.kind === "array"
            ? "Enter one value per line."
            : field.kind === "date"
              ? "Use YYYY, YYYY-MM or YYYY-MM-DD."
              : field.kind === "json"
                ? "Use an object with organization, description, proficiency, url, startDate or endDate."
                : "Leave blank to clear an optional value."}
        </p>
        {section === "projects" && key === "skills" && (
          <p>This list replaces only this project’s technologies.</p>
        )}
        {error && (
          <p role="alert" className="ui-error">
            {error}
          </p>
        )}
        <div className="candidate-actions">
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save and verify selected field"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setValue(inputText(record[key], field));
              setDirty(false);
              setError("");
              onDraft(token, null);
            }}
          >
            Discard field draft
          </button>
        </div>
      </form>
    </details>
  );
}
export function Empty({
  children = "No information was extracted for this section.",
}: {
  children?: ReactNode;
}) {
  return <p className="candidate-muted">{children}</p>;
}
export function Value({
  label,
  value,
  path,
  confidence,
}: {
  label: string;
  value: ReactNode;
  path?: string;
  confidence?: number | null;
}) {
  const manualFields = useContext(VerificationContext);
  const state = fieldReviewState(
    value,
    !!path && manualFields.includes(path),
    confidence,
  );
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === 0
          ? "0"
          : value || <span className="candidate-muted">Not identified</span>}
        {path && (
          <VerificationIndicator state={state} />
        )}
      </dd>
    </div>
  );
}
export function Bullets({ title, items }: { title: string; items: string[] }) {
  return items.length ? (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </>
  ) : null;
}
export function External({ url, label }: { url: string; label?: string | null }) {
  const href = safeLink(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label || url}
    </a>
  ) : (
    <span>{label || "Link unavailable"}</span>
  );
}
export function ReviewMark({
  verifiedAt,
  confidence,
}: {
  verifiedAt?: string | null;
  confidence?: number | null;
}) {
  return (
    <p className="candidate-muted record-review-state">
      {verifiedAt
        ? "Partially reviewed"
        : confidence != null && confidence < 0.75
          ? "Check original"
          : "Extracted"}
      {confidence != null
        ? ` · ${Math.round(confidence * 100)}% extraction confidence`
        : ""}
    </p>
  );
}
export function VerifiedFields({ prefix }: { prefix: string }) {
  const fields = useContext(VerificationContext)
    .filter((path) => path.startsWith(prefix + "."))
    .map((path) => path.slice(prefix.length + 1));
  return fields.length ? (
    <p className="field-state is-verified">
      Verified fields: {fields.join(", ")}
    </p>
  ) : null;
}

