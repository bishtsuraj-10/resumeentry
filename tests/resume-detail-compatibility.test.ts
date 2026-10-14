import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), find: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireApiSession: mock.auth, session: mock.session }));
vi.mock("@/lib/db", () => ({ db: { resume: { findUnique: mock.find } } }));
vi.mock("@/lib/processing", () => ({ saveReview: mock.review }));
import { GET, PATCH } from "../app/api/resumes/[id]/route";
const context = { params: Promise.resolve({ id: "legacy" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue(null);
  mock.session.mockResolvedValue({ id: "actor" });
  mock.find.mockResolvedValue({ id: "legacy", fileName: "synthetic.pdf", filePath: "/private/storage", fileSize: BigInt(1),
    status: "COMPLETED", claimToken: "private-token", leaseUntil: new Date(), scheduleAfter: new Date(),
    extraction: { name: "Legacy Candidate", email: "legacy@example.com", phone: null, designation: "Supplied" }, candidate: null, errors: [] });
  mock.review.mockImplementation(async (_db, _id, _actor, data) => ({ ...data, reviewedAt: new Date() }));
});
describe("legacy resume detail compatibility", () => {
  it("retains basic extraction, statuses and null candidate while hiding private internals", async () => {
    const response = await GET(new Request("http://localhost"), context);
    const body = await response.json();
    expect(body).toMatchObject({ id: "legacy", status: "COMPLETED", fileSize: 1, extraction: { name: "Legacy Candidate" }, candidate: null });
    for (const field of ["filePath", "claimToken", "leaseUntil", "scheduleAfter"]) expect(body).not.toHaveProperty(field);
  });
  it("preserves the four-field review contract and existing ownership-safe service", async () => {
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Human Candidate", email: "HUMAN@EXAMPLE.COM", phone: null, designation: "Human Title", claimToken: "injected" }) }), context);
    expect(response.status).toBe(200);
    expect(mock.review.mock.calls[0].slice(1, 3)).toEqual(["legacy", "actor"]);
    expect(mock.review.mock.calls[0][3]).toEqual({ name: "Human Candidate", email: "human@example.com", phone: null, normalizedPhone: null, countryCode: null, designation: "Human Title" });
  });
});
