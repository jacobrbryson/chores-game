import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRunWithRefreshedFirebaseToken,
  mockGetSessionFromRequest,
  mockSetSessionUserCookie,
  mockGetDocument,
  mockFindFirstFamilyIdByMemberUid,
  mockRunQuery,
} = vi.hoisted(() => ({
  mockRunWithRefreshedFirebaseToken: vi.fn(),
  mockGetSessionFromRequest: vi.fn(),
  mockSetSessionUserCookie: vi.fn(),
  mockGetDocument: vi.fn(),
  mockFindFirstFamilyIdByMemberUid: vi.fn(),
  mockRunQuery: vi.fn(),
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
vi.mock("@/lib/firestore/rest", () => ({
  getDocument: mockGetDocument,
  findFirstFamilyIdByMemberUid: mockFindFirstFamilyIdByMemberUid,
  runQuery: mockRunQuery,
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = (fields ?? {})[key];
    return Array.isArray(value) ? value : [];
  },
  readBoolean: (fields: Record<string, { booleanValue?: boolean }> | undefined, key: string) =>
    Boolean(fields?.[key]?.booleanValue),
  readString: (fields: Record<string, { stringValue?: string }> | undefined, key: string) =>
    fields?.[key]?.stringValue ?? "",
  readTimestamp: (fields: Record<string, { timestampValue?: string }> | undefined, key: string) =>
    fields?.[key]?.timestampValue ?? "",
  readInteger: (fields: Record<string, { integerValue?: string }> | undefined, key: string) =>
    Number(fields?.[key]?.integerValue ?? 0) || 0,
}));

import { GET } from "@/app/api/support/requests/my/route";

function makeRequest(query = "") {
  const url = new URL(`http://localhost/api/support/requests/my${query}`);
  return { nextUrl: url } as never;
}

function doc(
  id: string,
  createdByUid: string,
  createdAt: string,
  deleted = false,
  extra: Record<string, { stringValue?: string }> = {},
) {
  return {
    name: `projects/p/databases/(default)/documents/families/fam-1/supportRequests/${id}`,
    fields: {
      createdByUid: { stringValue: createdByUid },
      type: { stringValue: "feature" },
      subject: { stringValue: `subject-${id}` },
      description: { stringValue: "desc" },
      status: { stringValue: "submitted" },
      createdAt: { timestampValue: createdAt },
      updatedAt: { timestampValue: createdAt },
      deleted: { booleanValue: deleted },
      ...extra,
    },
  };
}

const session = {
  uid: "user-1",
  memberId: "member-1",
  email: "kid@example.com",
  firebaseIdToken: "id-token",
  firebaseRefreshToken: "refresh-token",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionFromRequest.mockReturnValue(session);
  mockGetDocument.mockResolvedValue({ fields: { familyIds: ["fam-1"] } });
  mockFindFirstFamilyIdByMemberUid.mockResolvedValue("");
  mockRunWithRefreshedFirebaseToken.mockImplementation(async (s: unknown, cb: (token: string) => unknown) => ({
    data: await cb("id-token"),
    session: s,
    refreshed: false,
  }));
});

describe("GET /api/support/requests/my", () => {
  it("requires a signed-in user", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("filters the query by the signed-in user's uid (ownership)", async () => {
    mockRunQuery.mockResolvedValue([]);
    await GET(makeRequest());
    const [structuredQuery, , parentPath] = mockRunQuery.mock.calls[0];
    expect(parentPath).toBe("families/fam-1");
    expect(structuredQuery.where.fieldFilter.field.fieldPath).toBe("createdByUid");
    expect(structuredQuery.where.fieldFilter.value.stringValue).toBe("user-1");
  });

  it("returns only non-deleted requests sorted newest-first with pagination", async () => {
    mockRunQuery.mockResolvedValue([
      doc("a", "user-1", "2026-06-01T01:00:00.000Z"),
      doc("b", "user-1", "2026-06-03T01:00:00.000Z"),
      doc("c", "user-1", "2026-06-02T01:00:00.000Z", true),
    ]);
    const res = await GET(makeRequest("?page=1&limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual(["b", "a"]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
  });

  it("normalizes legacy applied requests to done while preserving the change-log date", async () => {
    mockRunQuery.mockResolvedValue([
      doc("a", "user-1", "2026-06-01T00:00:00.000Z", false, {
        status: { stringValue: "applied" },
        appliedChangeLogDate: { stringValue: "2026-06-15" },
      }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.requests[0].status).toBe("done");
    expect(body.requests[0].appliedChangeLogDate).toBe("2026-06-15");
  });

  it("paginates the second page", async () => {
    mockRunQuery.mockResolvedValue([
      doc("a", "user-1", "2026-06-01T00:00:00.000Z"),
      doc("b", "user-1", "2026-06-02T00:00:00.000Z"),
      doc("c", "user-1", "2026-06-03T00:00:00.000Z"),
    ]);
    const res = await GET(makeRequest("?page=2&limit=2"));
    const body = await res.json();
    // newest-first: c, b, a -> page 2 (size 2) -> [a]
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual(["a"]);
    expect(body.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });
});
