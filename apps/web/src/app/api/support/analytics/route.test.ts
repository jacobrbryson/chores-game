import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionFromRequest, mockIsSupportAdmin, mockLoadAnalyticsSummary } = vi.hoisted(() => ({
  mockGetSessionFromRequest: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
  mockLoadAnalyticsSummary: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));
vi.mock("@/lib/support/access", () => ({
  isSupportAdmin: mockIsSupportAdmin,
}));
vi.mock("@/lib/analytics/query", () => ({
  loadAnalyticsSummary: mockLoadAnalyticsSummary,
}));

import { GET } from "@/app/api/support/analytics/route";

function makeRequest() {
  return { url: "https://app.test/api/support/analytics" } as never;
}

const session = { uid: "support-1", email: "support@example.com", name: "Support One" };

const summary = {
  scanned: 2,
  scanCap: 5000,
  capped: false,
  totalEvents: 2,
  eventsToday: 1,
  topEvents: [{ event: "chore_completed", count: 2 }],
  recentEvents: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionFromRequest.mockReturnValue(session);
  mockIsSupportAdmin.mockReturnValue(true);
  mockLoadAnalyticsSummary.mockResolvedValue(summary);
});

describe("GET /api/support/analytics", () => {
  it("returns 401 when not signed in", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockLoadAnalyticsSummary).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-support user", async () => {
    mockIsSupportAdmin.mockReturnValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("support_admin_required");
    expect(mockLoadAnalyticsSummary).not.toHaveBeenCalled();
  });

  it("returns the summary for a support admin", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toEqual(summary);
  });

  it("returns 500 when the query layer throws", async () => {
    mockLoadAnalyticsSummary.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("analytics_unavailable");
  });
});
