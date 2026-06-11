import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRunWithRefreshedFirebaseToken,
  mockGetSessionFromRequest,
  mockSetSessionUserCookie,
  mockCreateOrReplaceDocument,
  mockGetDocument,
  mockFindFirstFamilyIdByMemberUid,
  mockWriteAuditLogBestEffort,
  mockCheckRateLimit,
  mockConsumeRateLimit,
  mockIsSupportAdmin,
  mockLoadAllSupportRequests,
  mockFilterSupportRequests,
  mockSortSupportRequests,
  mockPaginateSupportRequests,
  mockSummarizeSupportRequests,
} = vi.hoisted(() => ({
  mockRunWithRefreshedFirebaseToken: vi.fn(),
  mockGetSessionFromRequest: vi.fn(),
  mockSetSessionUserCookie: vi.fn(),
  mockCreateOrReplaceDocument: vi.fn(),
  mockGetDocument: vi.fn(),
  mockFindFirstFamilyIdByMemberUid: vi.fn(),
  mockWriteAuditLogBestEffort: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
  mockLoadAllSupportRequests: vi.fn(),
  mockFilterSupportRequests: vi.fn(),
  mockSortSupportRequests: vi.fn(),
  mockPaginateSupportRequests: vi.fn(),
  mockSummarizeSupportRequests: vi.fn(),
}));

vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: mockRunWithRefreshedFirebaseToken,
}));
vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));
vi.mock("@/lib/auth/session-cookie", () => ({
  setSessionUserCookie: mockSetSessionUserCookie,
}));
vi.mock("@/lib/audit/log", () => ({
  writeAuditLogBestEffort: mockWriteAuditLogBestEffort,
}));
vi.mock("@/lib/rate-limit/limiter", () => ({
  checkRateLimit: mockCheckRateLimit,
  consumeRateLimit: mockConsumeRateLimit,
}));
vi.mock("@/lib/support/access", () => ({
  isSupportAdmin: mockIsSupportAdmin,
}));
vi.mock("@/lib/support/management", () => ({
  loadAllSupportRequests: mockLoadAllSupportRequests,
  filterSupportRequests: mockFilterSupportRequests,
  sortSupportRequests: mockSortSupportRequests,
  paginateSupportRequests: mockPaginateSupportRequests,
  summarizeSupportRequests: mockSummarizeSupportRequests,
}));
vi.mock("@/lib/firestore/rest", () => ({
  createOrReplaceDocument: mockCreateOrReplaceDocument,
  getDocument: mockGetDocument,
  findFirstFamilyIdByMemberUid: mockFindFirstFamilyIdByMemberUid,
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = (fields ?? {})[key];
    return Array.isArray(value) ? value : [];
  },
  stringField: (value: string) => ({ stringValue: value }),
  timestampField: (value: string) => ({ timestampValue: value }),
  boolField: (value: boolean) => ({ booleanValue: value }),
  integerField: (value: number) => ({ integerValue: String(value) }),
}));

// Email notification is best-effort; stub it so the create path stays pure.
vi.mock("@/lib/support/notify-email", () => ({
  sendSupportNotificationEmail: vi.fn(async () => true),
}));

import { POST } from "@/app/api/support/requests/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as never;
}

const session = {
  uid: "user-1",
  memberId: "member-1",
  role: "player",
  name: "Kid One",
  email: "kid@example.com",
  firebaseIdToken: "id-token",
  firebaseRefreshToken: "refresh-token",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  mockGetSessionFromRequest.mockReturnValue(session);
  mockGetDocument.mockResolvedValue({ fields: { familyIds: ["fam-1"] } });
  mockFindFirstFamilyIdByMemberUid.mockResolvedValue("");
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockConsumeRateLimit.mockResolvedValue(undefined);
  mockCreateOrReplaceDocument.mockResolvedValue(undefined);
  mockWriteAuditLogBestEffort.mockResolvedValue(undefined);
  mockIsSupportAdmin.mockReturnValue(true);
  mockLoadAllSupportRequests.mockResolvedValue([]);
  mockFilterSupportRequests.mockReturnValue([]);
  mockSortSupportRequests.mockReturnValue([]);
  mockPaginateSupportRequests.mockReturnValue({
    records: [],
    pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  });
  mockSummarizeSupportRequests.mockReturnValue({
    total: 0,
    byStatus: { new: 0, triaged: 0, planned: 0, in_progress: 0, done: 0, declined: 0, duplicate: 0 },
    byType: { bug: 0, feature: 0 },
    bugsBySeverity: { low: 0, medium: 0, high: 0 },
    highSeverityBugs: 0,
    recentCreatedLast7Days: 0,
    closedLast7Days: 0,
    averageHoursToClose: null,
  });
  mockRunWithRefreshedFirebaseToken.mockImplementation(async (s: unknown, cb: (token: string) => unknown) => ({
    data: await cb("id-token"),
    session: s,
    refreshed: false,
  }));
});

describe("GET /api/support/requests", () => {
  it("requires support admin access", async () => {
    mockIsSupportAdmin.mockReturnValue(false);
    const { GET } = await import("@/app/api/support/requests/route");
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(403);
  });

  it("returns paginated support requests and summary", async () => {
    const { GET } = await import("@/app/api/support/requests/route");
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.summary.total).toBe(0);
  });
});

describe("POST /api/support/requests", () => {
  it("requires a signed-in user", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const res = await POST(makeRequest({ type: "feature", subject: "x", description: "y" }));
    expect(res.status).toBe(401);
  });

  it("requires a Firebase token in the session", async () => {
    mockGetSessionFromRequest.mockReturnValue({ uid: "user-1" });
    const res = await POST(makeRequest({ type: "feature", subject: "x", description: "y" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("reauth_required");
  });

  it("rejects an invalid type", async () => {
    const res = await POST(makeRequest({ type: "nope", subject: "x", description: "y" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("type_invalid");
  });

  it("requires subject and description", async () => {
    const res1 = await POST(makeRequest({ type: "feature", subject: "", description: "y" }));
    expect((await res1.json()).error).toBe("subject_required");
    const res2 = await POST(makeRequest({ type: "feature", subject: "x", description: "" }));
    expect((await res2.json()).error).toBe("description_required");
  });

  it("requires severity for bug reports", async () => {
    const res = await POST(makeRequest({ type: "bug", subject: "x", description: "y" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("severity_required");
    expect(mockCreateOrReplaceDocument).not.toHaveBeenCalled();
  });

  it("rejects severity on feature requests", async () => {
    const res = await POST(
      makeRequest({ type: "feature", subject: "x", description: "y", severity: "low" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("severity_not_allowed");
  });

  it("returns 404 when the user has no active family", async () => {
    mockGetDocument.mockResolvedValue({ fields: { familyIds: [] } });
    mockFindFirstFamilyIdByMemberUid.mockResolvedValue("");
    const res = await POST(makeRequest({ type: "feature", subject: "x", description: "y" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("family_not_found");
  });

  it("returns 429 when rate limited and does not write the request", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, scope: "user", limit: 10 });
    const res = await POST(makeRequest({ type: "feature", subject: "x", description: "y" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.scope).toBe("user");
    expect(mockCreateOrReplaceDocument).not.toHaveBeenCalled();
  });

  it("creates a bug report with severity, audit log, and consumes quota", async () => {
    const res = await POST(
      makeRequest(
        { type: "bug", subject: "Crash", description: "It crashes", severity: "high" },
        { "user-agent": "TestAgent/1.0" },
      ),
    );
    expect(res.status).toBe(201);

    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(1);
    const [path, fields] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(path).toMatch(/^families\/fam-1\/supportRequests\//);
    expect(fields.type).toEqual({ stringValue: "bug" });
    expect(fields.severity).toEqual({ stringValue: "high" });
    expect(fields.status).toEqual({ stringValue: "new" });
    expect(fields.appliedChangeLogDate).toEqual({ stringValue: "" });
    expect(fields.createdByUid).toEqual({ stringValue: "user-1" });
    expect(fields.createdByMemberId).toEqual({ stringValue: "member-1" });
    expect(fields.userAgent).toEqual({ stringValue: "TestAgent/1.0" });
    expect(fields.deleted).toEqual({ booleanValue: false });

    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLogBestEffort).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAuditLogBestEffort.mock.calls[0][0];
    expect(auditArg.eventType).toBe("support_request_created");
    expect(auditArg.next.type).toBe("bug");
    // Description must never be written to the audit log.
    expect(JSON.stringify(auditArg)).not.toContain("It crashes");
  });

  it("creates a feature request without a severity field", async () => {
    const res = await POST(makeRequest({ type: "feature", subject: "Dark mode", description: "please" }));
    expect(res.status).toBe(201);
    const [, fields] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(fields.type).toEqual({ stringValue: "feature" });
    expect("severity" in fields).toBe(false);
  });
});
