import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionFromRequest, mockIsSupportAdmin, mockLoadOperationMetrics } = vi.hoisted(() => ({
  mockGetSessionFromRequest: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
  mockLoadOperationMetrics: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));
vi.mock("@/lib/support/access", () => ({
  isSupportAdmin: mockIsSupportAdmin,
}));
vi.mock("@/lib/observability/query", () => ({
  loadOperationMetrics: mockLoadOperationMetrics,
}));

import { GET } from "@/app/api/support/operations/route";

function makeRequest(url = "https://app.test/api/support/operations") {
  return { url } as never;
}

const session = {
  uid: "support-1",
  email: "support@example.com",
  name: "Support One",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionFromRequest.mockReturnValue(session);
  mockIsSupportAdmin.mockReturnValue(true);
  mockLoadOperationMetrics.mockResolvedValue([]);
});

describe("GET /api/support/operations", () => {
  it("returns 401 when not signed in", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockLoadOperationMetrics).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in non-support user", async () => {
    mockIsSupportAdmin.mockReturnValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("support_admin_required");
    expect(mockLoadOperationMetrics).not.toHaveBeenCalled();
  });

  it("returns metrics and a summary for a support admin", async () => {
    mockLoadOperationMetrics.mockResolvedValue([
      {
        id: "m1",
        area: "chores",
        operation: "list",
        durationMs: 1500,
        status: "slow",
        slow: true,
        resultCount: 50,
        requestedLimit: 50,
        hasNextPage: true,
        paginationRisk: true,
        riskReason: "result_count_equals_requested_limit",
        errorCode: "",
        familyId: "fam-1",
        userId: "user-1",
        metadata: {},
        createdAt: "2026-06-15T00:00:00.000Z",
      },
    ]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.summary.paginationRiskCount).toBe(1);
    expect(body.summary.health).toBe("warning");
  });

  it("passes parsed filters through to the query layer", async () => {
    await GET(
      makeRequest(
        "https://app.test/api/support/operations?rangeHours=168&area=feed&status=error&paginationRisksOnly=true&slowOnly=1",
      ),
    );
    const filters = mockLoadOperationMetrics.mock.calls[0][0];
    expect(filters.area).toBe("feed");
    expect(filters.status).toBe("error");
    expect(filters.paginationRisksOnly).toBe(true);
    expect(filters.slowOnly).toBe(true);
    expect(typeof filters.sinceMillis).toBe("number");
  });

  it("ignores an unknown area filter", async () => {
    await GET(makeRequest("https://app.test/api/support/operations?area=not-real"));
    const filters = mockLoadOperationMetrics.mock.calls[0][0];
    expect(filters.area).toBeUndefined();
  });

  it("returns 500 when the query layer throws", async () => {
    mockLoadOperationMetrics.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("operations_metrics_unavailable");
  });
});
