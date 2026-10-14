import type { SectionLine } from "./section-detector";
export interface MachineEvidence {
  fieldPath: string;
  sourceSection: string;
  text: string;
  location: {
    page: number;
    lineStart: number;
    lineEnd: number;
  };
  confidence: number;
  signals: string[];
}
// Deterministic rubric, not a calibrated probability: explicit label > section > contextual mention.
export function evidence(
  fieldPath: string,
  line: SectionLine,
  signals: string[] = ["SECTION_CONTEXT"],
  confidence = 0.82,
): MachineEvidence {
  return {
    fieldPath,
    sourceSection: line.section,
    text: line.text.slice(0, 500),
    location: { page: line.page, lineStart: line.line, lineEnd: line.line },
    confidence,
    signals,
  };
}
