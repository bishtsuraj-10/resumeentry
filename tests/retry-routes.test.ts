import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  auth: vi.fn(), session: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), audit: vi.fn(),
  retry: vi.fn(), schedule: vi.fn(), queue: {},
}));
vi.mock("@/lib/auth", () => ({ requireApiSession: mock.auth, session: mock.session }));
vi.mock("@/lib/db", () => ({ db: { resume: { findUnique: mock.findUnique, findMany: mock.findMany }, auditLog: { create: mock.audit } } }));
vi.mock("@/lib/queue", () => ({ getResumeQueue: () => mock.queue }));
vi.mock("@/lib/processing", () => ({ retryResume: mock.retry }));
vi.mock("@/lib/processing-queue", () => ({ scheduleResume: mock.schedule }));
import { POST as individual } from "../app/api/resumes/[id]/retry/route";
import { POST as bulk } from "../app/api/processing/retry-failed/route";

const request = () => new Request("http://localhost/api", { method: "POST" });
const context = { params: Promise.resolve({ id: "resume" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue(null);
  mock.session.mockResolvedValue({ id: "actor" });
  mock.findUnique.mockResolvedValue({ id: "resume", status: "FAILED" });
  mock.retry.mockResolvedValue({ id: "resume", processingGeneration: 1 });
  mock.schedule.mockResolvedValue("queued");
  mock.audit.mockResolvedValue({});
});
describe("retry HTTP contracts", () => {
  it("preserves individual and bulk permission checks", async () => {
    mock.auth.mockImplementation(async () => Response.json({ error: "Forbidden" }, { status: 403 }));
    expect((await individual(request(), context)).status).toBe(403);
    expect((await bulk(request())).status).toBe(403);
    expect(mock.auth.mock.calls.map((call) => call[0])).toEqual(["resumes.retry", "resumes.retry_all"]);
    expect(mock.retry).not.toHaveBeenCalled();
  });
  it("returns individual success with compatible queued flag", async () => {
    const response = await individual(request(), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ queued: true, accepted: true });
  });
  it("returns a conflict when another retry wins", async () => {
    mock.retry.mockResolvedValue(null);
    expect((await individual(request(), context)).status).toBe(409);
    expect(mock.schedule).not.toHaveBeenCalled();
  });
  it("returns durable acceptance with deferred scheduling during Redis outages", async () => {
    mock.schedule.mockResolvedValue("deferred");
    const response = await individual(request(), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ queued: false, deferred: true, accepted: true });
  });
  it("returns missing and ineligible records clearly", async () => {
    mock.findUnique.mockResolvedValue(null);
    expect((await individual(request(), context)).status).toBe(404);
    mock.findUnique.mockResolvedValue({ status: "COMPLETED" });
    expect((await individual(request(), context)).status).toBe(409);
  });
  it("continues across pages with bounded queue scheduling and accurate summaries", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ id: String(i).padStart(4, "0") }));
    mock.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: "0500" }]);
    mock.retry.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("temporary database failure")).mockResolvedValue({ id: "retried" });
    mock.schedule.mockResolvedValueOnce("queued").mockResolvedValueOnce("deferred");
    const response = await bulk(request());
    expect(await response.json()).toEqual({ retried: 1, skipped: 1, deferred: 498, failed: 1 });
    expect(mock.findMany.mock.calls[1][0].where.id).toEqual({ gt: "0499" });
    expect(mock.schedule).toHaveBeenCalledTimes(2);
  });
});
