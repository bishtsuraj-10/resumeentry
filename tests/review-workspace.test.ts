import { describe, expect, it } from "vitest";
import { fieldReviewState, mergeReviewDrafts, verificationPrefix } from "../lib/review-workspace";
import { candidatePatchSchema } from "../lib/candidate-validation";

describe("review workspace drafts", () => {
  it("uses persisted evidence paths rather than the extraction row ID for identity verification", () => {
    expect(verificationPrefix("basic", { id: "extraction-row" })).toBe("basic");
    expect(verificationPrefix("profile", { resumeId: "resume" })).toBe("profile");
    expect(verificationPrefix("employment", { id: "job" })).toBe("employment.job");
    expect(verificationPrefix("skills", { skillId: "skill" })).toBe("skills.skill");
  });
  it("merges separate records and only submitted fields into one valid revision-safe patch", () => {
    const changes = mergeReviewDrafts([
      { basic: { designation: "Engineer" } },
      { profile: { city: "Delhi" } },
      { employment: { upsert: [{ id: "job-1", employer: "Example" }] } },
      { employment: { upsert: [{ id: "job-1", location: "Remote" }] } },
      { employment: { upsert: [{ id: "job-2", designation: "Developer" }] } },
      { skills: { upsert: [{ name: "SQL", context: "Work" }] } },
    ]);
    expect(changes).toEqual({ basic: { designation: "Engineer" }, profile: { city: "Delhi" }, employment: { upsert: [{ id: "job-1", employer: "Example", location: "Remote" }, { id: "job-2", designation: "Developer" }] }, skills: { upsert: [{ name: "SQL", context: "Work" }] } });
    expect(candidatePatchSchema.safeParse({ expectedRevision: 3, ...changes }).success).toBe(true);
    expect(changes).not.toHaveProperty("completeReview");
    expect(changes.basic).not.toHaveProperty("email");
  });
  it("does not confuse missing values, zero experience, false flags or machine uncertainty with suitability", () => {
    expect(fieldReviewState(null, false)).toContain("Missing");
    expect(fieldReviewState([], false)).toContain("optional");
    expect(fieldReviewState(0, false)).toBe("Machine extracted");
    expect(fieldReviewState(false, false)).toBe("Machine extracted");
    expect(fieldReviewState("Example", false, .3)).toBe("Uncertain extraction");
    expect(fieldReviewState("Example", true, .3)).toBe("Manually verified");
    expect(fieldReviewState(null, true)).toBe("Manually verified");
  });
});
