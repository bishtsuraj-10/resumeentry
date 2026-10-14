// Combine only explicit drafts. Never include displayed, unchanged fields.
export function verificationPrefix(section: string, record: object) {
  if (section === "basic" || section === "profile") return section;
  if ("skillId" in record) return `${section}.${String(record.skillId)}`;
  if ("id" in record) return `${section}.${String(record.id)}`;
  return section;
}

export function mergeReviewDrafts(drafts: Record<string, unknown>[]) {
  const result: Record<string, unknown> = {};
  for (const draft of drafts) {
    for (const [section, value] of Object.entries(draft)) {
      const incoming = value as Record<string, unknown>;
      if (section === "basic" || section === "profile") {
        result[section] = { ...(result[section] as object), ...incoming };
      } else {
        const previous = (result[section] ?? {}) as { upsert?: Record<string, unknown>[] };
        const entries = [...(previous.upsert ?? [])];
        for (const entry of incoming.upsert as Record<string, unknown>[]) {
          const index = entries.findIndex(v => entry.id ? v.id === entry.id : entry.name ? v.name === entry.name : false);
          if (index < 0) entries.push(entry);
          else entries[index] = { ...entries[index], ...entry };
        }
        result[section] = { ...previous, upsert: entries };
      }
    }
  }
  return result;
}

export function fieldReviewState(value: unknown, verified: boolean, confidence?: number | null) {
  if (verified) return "Manually verified";
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "Missing · optional unless required";
  if (confidence != null && confidence < 0.75) return "Uncertain extraction";
  return "Machine extracted";
}
