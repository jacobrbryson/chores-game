import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionFromRequest, mockIsSupportAdmin, mockLoadAllSupportRequests, mockSummarizeSupportRequests } =
  vi.hoisted(() => ({
    mockGetSessionFromRequest: vi.fn(),
    mockIsSupportAdmin: vi.fn(),
    mockLoadAllSupportRequests: vi.fn(),
    mockSummarizeSupportRequests: vi.fn(),
  }));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mockGetSessionFromRequest }));
vi.mock("@/lib/support/access", () => ({ isSupportAdmin: mockIsSupportAdmin }));
vi.mock("@/lib/support/management", () => ({
  loadAllSupportRequests: mockLoadAllSupportRequests,
  summarizeSupportRequests: mockSummarizeSupportRequests,
}));

import { GET } from "@/app/api/support/requests/summary/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionFromRequest.mockReturnValue({ uid: "support-1" });
  mockIsSupportAdmin.mockReturnValue(true);
  mockLoadAllSupportRequests.mockResolvedValue([]);
  mockSummarizeSupportRequests.mockReturnValue({ total: 0 });
});

describe("GET /api/support/requests/summary", () => {
  it("requires support admin access", async () => {
    mockIsSupportAdmin.mockReturnValue(false);
    const res = await GET({} as never);
    expect(res.status).toBe(403);
  });

  it("returns the summary payload", async () => {
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toEqual({ total: 0 });
  });
});
