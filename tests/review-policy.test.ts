import { describe, expect, it } from "vitest";
import { extractStructuredResume } from "../lib/resume-parser";
import { reviewDecision } from "../lib/resume-parser/review-policy";
const text =
  "JAMIE REED\nMechanical Engineer\njamie.reed@example.com\n+1 313 555 0101";
describe("review reasons remain independent of the displayed confidence", () => {
  it("does not route a complete, high-confidence record to review for layout diagnostics alone", () => {
    const p = extractStructuredResume(text);
    expect(
      reviewDecision(p.basic, ["LAYOUT_READING_ORDER_UNCERTAIN"], "75")
        .requiresReview,
    ).toBe(false);
  });
  it("keeps unresolved records and weak OCR in review even with strong basic confidence", () => {
    const p = extractStructuredResume(text);
    expect(
      reviewDecision(p.basic, ["UNRESOLVED_EMPLOYMENT", "LOW_OCR_CONFIDENCE"])
        .requiresReview,
    ).toBe(true);
  });
  it("cannot pass incomplete identity or an invalid threshold", () => {
    const p = extractStructuredResume(text);
    p.basic.name = null;
    expect(reviewDecision(p.basic, [], "NaN")).toMatchObject({
      requiresReview: true,
      threshold: 0.75,
      reasons: ["MISSING_NAME"],
    });
  });
});
