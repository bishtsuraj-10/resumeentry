import { describe, expect, it, vi, afterEach } from "vitest";
import { reviewDecision } from "../lib/resume-parser/review-policy";

const basic = () => ({ name: "李 明", email: "candidate@example.com", phone: "+919876543210", designation: "Engineer", overallConfidence: 0.75 });
const candidate = () => ({ locationText: "Bengaluru",    summary: "Builds applications for internal operations.", skills: [{ skill: { canonicalName: "C++" } }], links: [{ url: "https://example.com/profile" }] });
afterEach(() => vi.unstubAllEnvs());
describe("saved candidate two-layer automatic completion", () => {
  it.each([[0.75, false], [0.7499, true], [0.85, false]])("all eight fields at %s: requiresReview=%s", (overallConfidence, requiresReview) => {
    expect(reviewDecision({ ...basic(), overallConfidence }, candidate()).requiresReview).toBe(requiresReview);
  });
  it.each([[0.85, false], [0.8499, true], [0.75, true]])("absent links at %s: requiresReview=%s", (overallConfidence, requiresReview) => {
    expect(reviewDecision({ ...basic(), overallConfidence }, { ...candidate(), links: [] })).toMatchObject({ requiresReview, threshold: 0.85, reasons: expect.arrayContaining(["MISSING_LINKS"]) });
  });
  it.each(["locationText", "summary"] as const)("missing %s blocks 99 percent", (field) => {
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, { ...candidate(), [field]: null }).requiresReview).toBe(true);
  });
  it.each(["name", "email", "phone", "designation"] as const)("missing %s blocks 99 percent", (field) => {
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99, [field]: null }, candidate()).requiresReview).toBe(true);
  });
  it("missing skills or profile blocks 99 percent", () => {
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, { ...candidate(), skills: [] }).requiresReview).toBe(true);
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, null).requiresReview).toBe(true);
  });
  it.each([" ", "N/A", "Unknown", "Not Provided", "---", "12345"])("rejects meaningless required text %s", (value) => {
    for (const field of ["name", "designation"])
      expect(reviewDecision({ ...basic(), overallConfidence: 0.99, [field]: value }, candidate()).requiresReview).toBe(true);
    for (const field of ["locationText", "summary"])
      expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, { ...candidate(), [field]: value }).requiresReview).toBe(true);
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, { ...candidate(), skills: [{ skill: { canonicalName: value } }] }).requiresReview).toBe(true);
  });
  it.each(["garbage", "N/A", " "])("validates contacts using the candidate contract: %s", (value) => {
    for (const field of ["email", "phone"])
      expect(reviewDecision({ ...basic(), overallConfidence: 0.99, [field]: value }, candidate()).requiresReview).toBe(true);
  });
  it.each(["javascript:alert(1)", "ftp://example.com", "https://user:password@example.com", "not a url", "N/A"])("unusable supplied URL stays in review: %s", (url) => {
    expect(reviewDecision({ ...basic(), overallConfidence: 0.99 }, { ...candidate(), links: [{ url }] })).toMatchObject({ requiresReview: true, reasons: expect.arrayContaining(["INVALID_LINKS"]) });
  });
  it("permits optional DOB, experience and education to remain absent", () => {
    expect(reviewDecision(basic(), { ...candidate(), dateOfBirth: null, totalExperienceMonths: null, employment: [], education: [] } as ReturnType<typeof candidate>).requiresReview).toBe(false);
  });
  it("accepts international text and one meaningful skill/link among invalid entries", () => {
    expect(reviewDecision({ ...basic(), designation: "研发工程师" }, { ...candidate(), locationText: "東京都", summary: "業務アプリケーションを開発。", skills: [{ skill: { canonicalName: "N/A" } }, ...candidate().skills], links: [{ url: "invalid" }, { url: "http://example.com" }] }).requiresReview).toBe(false);
  });
  it("uses retained location and ignores obsolete threshold configuration", () => {
    vi.stubEnv("CONFIDENCE_THRESHOLD", "99");
    expect(reviewDecision(basic(), candidate()).requiresReview).toBe(false);
  });
  it.each([NaN, Infinity, -1, 75])("rejects invalid stored confidence %s", (overallConfidence) => {
    expect(reviewDecision({ ...basic(), overallConfidence }, candidate()).requiresReview).toBe(true);
  });
});
