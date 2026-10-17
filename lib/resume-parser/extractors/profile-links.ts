import { safeUrlSchema } from "../../candidate-validation";
import type { SectionLine } from "../section-detector";
import { evidence, type MachineEvidence } from "../field-confidence";
export function extractLinks(lines: SectionLine[]) {
  const links = new Map<
    string,
    {
      type: "LINKEDIN" | "GITHUB" | "PORTFOLIO" | "WEBSITE" | "OTHER";
      url: string;
    }
  >();
  const proofs: MachineEvidence[] = [];
  const warnings = new Set<string>();
  for (const line of lines.filter((l) =>
    ["header", "personal"].includes(l.section),
  )) {
    if (
      /\b(?:employer|company|reference|referee|recruiter|advertisement|advertising|sponsored|certification|credential|project)\s*(?:website|url|link|portfolio)?\s*(?::|\(|https?:|$)/i.test(
        line.text,
      )
    )
      continue;
    const supplied = line.text.match(
      /\b(?:linkedin|github|portfolio|website|personal site|profile link)\s*:\s*(.*)$/i,
    );
    if (/\b(?:javascript|data|file|vbscript|ftp):/i.test(line.text)) {
      warnings.add("INVALID_PROFESSIONAL_LINK");
      continue;
    }
    let validOnLine = false;
    // Repair only scheme punctuation. The destination must remain fully visible;
    // never repair or invent a hostname. Bare domains cannot be email suffixes.
    const text = line.text.replace(
      /\b(https?)\s*:?\s*\/{1,2}\s*(?=[\w-]+\.)/gi,
      "$1://",
    );
    for (const match of text.matchAll(
      /https?:\/\/[^\s<>]+|(?<![\w@./-])(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s<>]*)?/gi,
    )) {
      const raw = match[0].replace(/[),.;]+$/, "");
      if (text[(match.index ?? 0) + match[0].length] === "@") continue;
      if (
        !/^https?:/i.test(raw) &&
        !/(?:linkedin\.com\/in\/|github\.com\/)/i.test(raw) &&
        !/\b(?:portfolio|website|personal site|profile|https?)\b/i.test(text) &&
        text.trim().replace(/[),.;]+$/, "") !== raw
      )
        continue;
      const result = safeUrlSchema.safeParse(
        /^https?:/i.test(raw) ? raw : "https://" + raw,
      );
      if (
        !result.success ||
        !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(new URL(result.data).hostname)
      ) {
        warnings.add("INVALID_PROFESSIONAL_LINK");
        continue;
      }
      validOnLine = true;
      const host = new URL(result.data).hostname
        .replace(/^www\./, "")
        .toLowerCase();
      const type =
        host === "linkedin.com"
          ? "LINKEDIN"
          : host === "github.com"
            ? "GITHUB"
            : /portfolio/i.test(line.text)
              ? "PORTFOLIO"
              : /website|personal site/i.test(line.text)
                ? "WEBSITE"
                : "OTHER";
      if (!links.has(result.data)) {
        const index = links.size;
        links.set(result.data, { type, url: result.data });
        proofs.push(
          evidence(
            `links.${index}.url`,
            line,
            ["VALIDATED_URL", "CANDIDATE_HEADER"],
            0.96,
          ),
        );
      }
    }
    if (
      supplied &&
      !validOnLine &&
      !/^(?:none|n\/?a|not available|not provided)$/i.test(supplied[1].trim())
    )
      warnings.add(
        supplied[1].trim()
          ? "INVALID_PROFESSIONAL_LINK"
          : "UNRESOLVED_PROFESSIONAL_LINK",
      );
    // Check each supplied label independently: one valid portfolio must not hide
    // a malformed LinkedIn value in another cell on the same contact row.
    for (const cell of line.text.split(/[|\t]/)) {
      const label = cell
        .trim()
        .match(
          /^(?:linkedin|github|portfolio|website|personal site|profile link)\s*:\s*(.*)$/i,
        );
      if (
        !label ||
        /^(?:none|n\/?a|not available|not provided)$/i.test(label[1].trim())
      )
        continue;
      const candidates =
        label[1].match(
          /https?:\/\/[^\s<>]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>]*)?/gi,
        ) ?? [];
      const valid = candidates.some((v) => {
        const parsed = safeUrlSchema.safeParse(
          /^https?:/i.test(v) ? v : "https://" + v,
        );
        return (
          parsed.success &&
          /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(new URL(parsed.data).hostname)
        );
      });
      if (!valid)
        warnings.add(
          label[1].trim()
            ? "INVALID_PROFESSIONAL_LINK"
            : "UNRESOLVED_PROFESSIONAL_LINK",
        );
    }
    if (/^(?:linkedin|github|portfolio|website)$/i.test(line.text.trim()))
      warnings.add("UNRESOLVED_PROFESSIONAL_LINK");
    // A malformed explicit HTTP target must not silently become absent either.
    if (/https?:\/\//i.test(line.text) && !validOnLine)
      warnings.add("INVALID_PROFESSIONAL_LINK");
  }
  return {
    items: [...links.values()].slice(0, 100),
    evidence: proofs,
    warnings: [...warnings],
  };
}
