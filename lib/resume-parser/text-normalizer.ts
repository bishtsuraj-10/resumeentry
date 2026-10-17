export interface SourceLine {
  text: string;
  line: number;
  page: number;
  columnStart?: boolean;
}
function wrappedPlace(previous: string, next: string) {
  if (!/,|^(?:location|address|based in)\s*:/i.test(previous)) return false;
  return ["United States", "United Kingdom", "United Arab Emirates", "South Africa", "New Zealand", "District of Columbia"].some(place => {
    const words = place.split(" ");
    return words.slice(1).some((_, index) =>
      new RegExp(`\\b${words.slice(0, index + 1).join(" ")}$`, "i").test(previous) &&
      new RegExp(`^${words.slice(index + 1).join(" ")}(?:,\\s*[\\p{L} .'-]+)?$`, "iu").test(next),
    );
  });
}
export function normalizeText(text: string): SourceLine[] {
  let page = 1;
  let pageLine = 0;
  const lines: SourceLine[] = [];
  let columnStart = false;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (raw === "\v") {
      columnStart = true;
      continue;
    }
    if (raw.includes("\f")) {
      page += (raw.match(/\f/g) ?? []).length;
      pageLine = 0;
    }
    const value = raw
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00AD/g, "")
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/\f/g, "")
      .replace(/[ ]+/g, " ")
      .trim();
    if (
      !value ||
      /^[- ]*\d+ (?:of|\/) \d+[- ]*$/i.test(value) ||
      /^page \d+(?: of \d+)?$/i.test(value) ||
      /^[^|]{2,80}\s*\|.+\|\s*\d+\s*\/\s*\d+$/.test(value)
    )
      continue;
    pageLine++;
    if (
      page > 1 &&
      pageLine <= 3 &&
      lines
        .slice(0, 2)
        .some((l) => value === l.text || value.startsWith(l.text + " | "))
    )
      continue;
    const previous = lines[lines.length - 1];
    if (previous?.page === page && /^other personal$/i.test(previous.text) && /^details$/i.test(value)) {
      previous.text += " " + value;
      continue;
    }
    if (
      !columnStart && previous?.page === page &&
      wrappedPlace(previous.text, value)
    )
      previous.text += " " + value;
    else if (
      !columnStart && previous?.page === page &&
      /^https?:\/\/\S+$/i.test(previous.text) &&
      /^[a-z0-9/_~.%+-]+$/.test(value) &&
      (/[\/.-]/.test(value) || /[\/.-]$/.test(previous.text)) &&
      !/^\d+$/.test(value)
    ) {
      previous.text += value;
    } else {
      lines.push({ text: value, line: index + 1, page, ...(columnStart ? { columnStart: true } : {}) });
      columnStart = false;
    }
  }
  return lines;
}
export function assessTextQuality(text: string) {
  const printable = text.replace(/\s/g, "");
  const letters = (printable.match(/\p{L}/gu) ?? []).length;
  const corruption = (
    printable.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) ?? []
  ).length;
  const tokens = text.match(/\p{L}{2,}/gu) ?? [];
  const uniqueRatio =
    new Set(tokens.map((t) => t.toLowerCase())).size /
    Math.max(tokens.length, 1);
  const signals = {
    letters,
    tokenCount: tokens.length,
    corruptionRatio: corruption / Math.max(printable.length, 1),
    uniqueRatio,
  };
  const warnings: string[] = [];
  if (letters < 20 || tokens.length < 5) warnings.push("SPARSE_TEXT");
  if (signals.corruptionRatio > 0.02) warnings.push("CORRUPT_TEXT");
  if (tokens.length > 30 && uniqueRatio < 0.1) warnings.push("REPETITIVE_TEXT");
  return { usable: warnings.length === 0, warnings, signals };
}
