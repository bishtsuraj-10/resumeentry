import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateDataError } from "../lib/candidate-data";
import { candidatePatchSchema } from "../lib/candidate-validation";

const mock = vi.hoisted(() => ({
  auth: vi.fn(), session: vi.fn(), read: vi.fn(), patch: vi.fn(), provenance: vi.fn(), evidence: vi.fn(), find: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireApiSession: mock.auth, session: mock.session }));
vi.mock("@/lib/db", () => ({ db: { resume: { findUnique: mock.find } } }));
vi.mock("@/lib/candidate-data", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/candidate-data")>(),
  readCandidate: mock.read, patchCandidate: mock.patch, readCandidateProvenance: mock.provenance, readRunEvidence: mock.evidence,
}));
import { GET, PATCH } from "../app/api/resumes/[id]/candidate/route";
import { GET as provenance } from "../app/api/resumes/[id]/candidate/provenance/route";

const context = { params: Promise.resolve({ id: "synthetic-resume" }) };
const request = (body: unknown = { expectedRevision: 0, profile: { locationText: "Example" } }) =>
  new Request("http://localhost/api/resumes/synthetic-resume/candidate", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue(null);
  mock.session.mockResolvedValue({ id: "synthetic-actor" });
  mock.read.mockResolvedValue({ resumeId: "synthetic-resume", revision: 0, candidate: null });
  mock.patch.mockImplementation(async (_db, _id, _actor, body) => { candidatePatchSchema.parse(body); return { revision: 1 }; });
  mock.find.mockResolvedValue({ id: "synthetic-resume" });
  mock.provenance.mockResolvedValue([]);
  mock.evidence.mockResolvedValue(null);
});
describe("candidate API contracts", () => {
  it("enforces view/edit permission before reads, writes and private evidence", async () => {
    mock.auth.mockImplementation(async () => Response.json({ error: "Forbidden" }, { status: 403 }));
    expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
    expect((await PATCH(request(), context)).status).toBe(403);
    expect((await provenance(new Request("http://localhost"), context)).status).toBe(403);
    expect(mock.auth.mock.calls.map((call) => call[0])).toEqual(["resumes.view", "resumes.edit", "resumes.edit"]);
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.patch).not.toHaveBeenCalled();
    expect(mock.provenance).not.toHaveBeenCalled();
  });
  it("requires an authenticated actor for writes", async () => {
    mock.session.mockResolvedValue(null);
    expect((await PATCH(request(), context)).status).toBe(401);
    expect(mock.patch).not.toHaveBeenCalled();
  });
  it("returns optional structured data and disables caching", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ candidate: null, revision: 0 });
  });
  it("returns revision acknowledgments and binds writes to the route's resume", async () => {
    const response = await PATCH(request(), context);
    expect(await response.json()).toEqual({ revision: 1 });
    expect(mock.patch.mock.calls[0].slice(1, 3)).toEqual(["synthetic-resume", "synthetic-actor"]);
  });
  it("rejects mass assignment and candidate identifiers", async () => {
    for (const body of [{ expectedRevision: 0, resumeId: "other", profile: { locationText: "Injected" } }, { expectedRevision: 0, profile: { claimToken: "injected" } }])
      expect((await PATCH(request(body), context)).status).toBe(400);
  });
  it("returns clear conflicts without echoing submitted data", async () => {
    mock.patch.mockRejectedValue(new CandidateDataError(409, "Candidate changed; reload before editing."));
    const response = await PATCH(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Candidate changed; reload before editing." });
  });
  it("returns missing records clearly", async () => {
    mock.read.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost"), context)).status).toBe(404);
    mock.find.mockResolvedValue(null);
    expect((await provenance(new Request("http://localhost"), context)).status).toBe(404);
  });
  it("rejects malformed, incorrectly typed and oversized JSON", async () => {
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: "{}", headers: { "content-type": "text/plain" } }), context)).status).toBe(415);
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: "{", headers: { "content-type": "application/json" } }), context)).status).toBe(400);
    expect((await PATCH(request({ value: "x".repeat(256 * 1024) }), context)).status).toBe(413);
  });
  it("paginates private provenance and rejects invalid pages", async () => {
    expect((await provenance(new Request("http://localhost?page=0"), context)).status).toBe(400);
    expect((await provenance(new Request("http://localhost?page=2"), context)).status).toBe(200);
    expect(mock.provenance.mock.calls[0].slice(1)).toEqual(["synthetic-resume", 2]);
  });
  it("scopes paginated evidence lookup to the route's resume", async () => {
    expect((await provenance(new Request("http://localhost?runId=other-run"), context)).status).toBe(404);
    expect(mock.evidence.mock.calls[0].slice(1)).toEqual(["synthetic-resume", "other-run", 1]);
  });
  it("does not expose dependency exception contents", async () => {
    mock.patch.mockRejectedValue(new Error("private dependency details"));
    const response = await PATCH(request(), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
