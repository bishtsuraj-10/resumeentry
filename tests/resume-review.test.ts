import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  loadResume,
  requestJson,
  changedFields,
  dateLabel,
  experienceLabel,
  safeLink,
} from "../lib/resume-review";
import { candidatePatchSchema } from "../lib/candidate-validation";
import { highestEducation } from "../lib/resume-overview";
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const record = {
  id: "synthetic",
  fileName: "synthetic.pdf",
  fileType: "pdf",
  status: "REVIEW",
  extraction: null,
  candidate: null,
};
describe("resume detail request regression", () => {
  it("loads an empty-extraction legacy record using an ID and a real async function", async () => {
    fetchMock.mockResolvedValue(Response.json(record));
    expect(await loadResume("synthetic", new AbortController().signal)).toEqual(
      record,
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/resumes/synthetic");
  });
  it.each([401, 403, 404, 500])(
    "reports unsuccessful HTTP %s without hiding the error",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: "Synthetic request rejected." }, { status }),
      );
      await expect(
        loadResume("synthetic", new AbortController().signal),
      ).rejects.toThrow("Synthetic request rejected.");
    },
  );
  it.each([null, {}, [], { id: "synthetic", fileName: "synthetic.pdf" }])(
    "rejects empty or incomplete payloads: %j",
    async (value) => {
      fetchMock.mockResolvedValue(Response.json(value));
      await expect(
        loadResume("synthetic", new AbortController().signal),
      ).rejects.toThrow();
    },
  );
  it("rejects aborted responses after JSON resolves", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        controller.abort();
        return record;
      },
    });
    await expect(loadResume("synthetic", controller.signal)).rejects.toThrow();
  });
  it("preserves network failures for a visible retry state", async () => {
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    await expect(
      loadResume("synthetic", new AbortController().signal),
    ).rejects.toThrow("Network unavailable");
  });
  it("makes conflicts actionable without retrying a stale edit", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "Candidate changed." }, { status: 409 }),
    );
    await expect(
      requestJson("/synthetic", { method: "PATCH" }),
    ).rejects.toThrow("unsaved changes have been kept");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe("review compatibility and precision", () => {
  it("validates a one-field basic correction and a separate completion action", () => {
    expect(
      candidatePatchSchema.parse({
        expectedRevision: 3,
        basic: { designation: "Civil Engineer" },
      }),
    ).toEqual({
      expectedRevision: 3,
      basic: { designation: "Civil Engineer" },
    });
    expect(
      candidatePatchSchema.parse({ expectedRevision: 3, completeReview: true }),
    ).toEqual({ expectedRevision: 3, completeReview: true });
    expect(
      candidatePatchSchema.safeParse({
        expectedRevision: 3,
        basic: { claimToken: "injection" },
      }).success,
    ).toBe(false);
    expect(
      candidatePatchSchema.safeParse({
        expectedRevision: 3,
        basic: { phone: "123" },
      }).success,
    ).toBe(false);
  });
  it("never sends unchanged unrelated values", () =>
    expect(
      changedFields(
        { summary: "Original", city: "A" },
        { summary: "Original", city: "B" },
      ),
    ).toEqual({ city: "B" }));
  it("formats unknown values and partial dates without inventing precision", () => {
    expect(experienceLabel(null)).toBe("Not identified");
    expect(experienceLabel(125)).toBe("10y 5m");
    expect(dateLabel({ startYear: 2024, startMonth: null }, "start")).toBe(
      "2024",
    );
    expect(safeLink("javascript:alert(1)")).toBeUndefined();
    expect(safeLink("https://example.com")).toBe("https://example.com/");
  });
  it("ranks only identified qualifications, not the newest certificate or filename", () => {
    const records = [
      { degree: "Bachelor of Science", fieldOfStudy: "Math", endYear: 2015 },
      { degree: "Master of Science", fieldOfStudy: "Analytics", endYear: 2018 },
      {
        degree: "Postgraduate Certificate",
        fieldOfStudy: "GIS",
        endYear: 2025,
      },
    ];
    expect(highestEducation(records)?.degree).toBe("Master of Science");
    expect(highestEducation([])).toBeUndefined();
  });
});
