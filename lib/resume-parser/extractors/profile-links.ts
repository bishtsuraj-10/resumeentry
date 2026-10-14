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
  for (const line of lines.filter((l) =>
    ["header", "personal", "projects"].includes(l.section),
  )) {
    if (/\b(?:javascript|data|file|vbscript):/i.test(line.text)) continue;
    for (const match of line.text.matchAll(
      /https?:\/\/[^\s<>]+|(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/)[\w./-]+/gi,
    )) {
      const raw = match[0].replace(/[),.;]+$/, "");
      const result = safeUrlSchema.safeParse(
        /^https?:/i.test(raw) ? raw : "https://" + raw,
      );
      if (!result.success) continue;
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
  }
  return { items: [...links.values()].slice(0, 100), evidence: proofs };
}
