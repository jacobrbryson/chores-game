import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRunWithRefreshedFirebaseToken,
  mockGetSessionFromRequest,
  mockSetSessionUserCookie,
  mockGetDocument,
  mockPatchDocument,
  mockFindFirstFamilyIdByMemberUid,
  mockAdminCommitWrites,
  mockAdminGetDocument,
  mockLoadSupportRequestDetail,
  mockIsSupportAdmin,
} = vi.hoisted(() => ({
  mockRunWithRefreshedFirebaseToken: vi.fn(),
  mockGetSessionFromRequest: vi.fn(),
  mockSetSessionUserCookie: vi.fn(),
  mockGetDocument: vi.fn(),
  mockPatchDocument: vi.fn(),
  mockFindFirstFamilyIdByMemberUid: vi.fn(),
  mockAdminCommitWrites: vi.fn(),
  mockAdminGetDocument: vi.fn(),
  mockLoadSupportRequestDetail: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: mockRunWithRefreshedFirebaseToken,
}));
vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));
vi.mock("@/lib/auth/session-cookie", () => ({ setSessionUserCookie: mockSetSessionUserCookie }));
vi.mock("@/lib/support/access", () => ({ isSupportAdmin: mockIsSupportAdmin }));
vi.mock("@/lib/support/management", () => ({ loadSupportRequestDetail: mockLoadSupportRequestDetail }));
vi.mock("@/lib/firestore/admin", () => ({
  adminCommitWrites: mockAdminCommitWrites,
  adminGetDocument: mockAdminGetDocument,
}));
vi.mock("@/lib/firestore/rest", () => ({
  getDocument: mockGetDocument,
  patchDocument: mockPatchDocument,
  findFirstFamilyIdByMemberUid: mockFindFirstFamilyIdByMemberUid,
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = (fields ?? {})[key];
    return Array.isArray(value) ? value : [];
  },
  readString: (fields: Record<string, { stringValue?: string }> | undefined, key: string) =>
    fields?.[key]?.stringValue ?? "",
  readBoolean: (fields: Record<string, { booleanValue?: boolean }> | undefined, key: string) =>
    Boolean(fields?.[key]?.booleanValue),
  stringField: (value: string) => ({ stringValue: value }),
  boolField: (value: boolean) => ({ booleanValue: value }),
  timestampField: (value: string) => ({ timestampValue: value }),
  mapField: (value: Record<string, unknown>) => ({ mapValue: { fields: value } }),
}));

import { DELETE, GET, PATCH } from "@/app/api/support/requests/[supportRequestId]/route";

const session = {
  uid: "u1",
  role: "admin",
  email: "support@example.com",
  name: "Support User",
  firebaseIdToken: "id-token",
  firebaseRefreshToken: "refresh-token",
};

function req(body: unknown) {
  return { json: async () => body, nextUrl: { searchParams: new URLSearchParams() } } as never;
}
function ctx(id = "req-1") {
  return { params: Promise.resolve({ supportRequestId: id }) };
}

type DocFields = Record<string, { stringValue?: string; booleanValue?: boolean }>;

function setRequestDoc(fields: DocFields) {
  mockGetDocument.mockImplementation((path: string) => {
    if (path === "users/u1") {
      return Promise.resolve({ fields: { familyIds: ["fam-1"] } });
    }
    if (path === "families/fam-1/supportRequests/req-1") {
      return Promise.resolve({ fields });
    }
    return Promise.reject(new Error("FIRESTORE_HTTP_404"));
  });
}

const bugNew: DocFields = {
  createdByUid: { stringValue: "u1" },
  status: { stringValue: "new" },
  type: { stringValue: "bug" },
  deleted: { booleanValue: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionFromRequest.mockReturnValue(session);
  mockFindFirstFamilyIdByMemberUid.mockResolvedValue("");
  mockPatchDocument.mockResolvedValue(undefined);
  mockAdminCommitWrites.mockResolvedValue(undefined);
  mockAdminGetDocument.mockResolvedValue({ fields: bugNew });
  mockLoadSupportRequestDetail.mockResolvedValue({
    request: { id: "req-1", familyId: "fam-1", status: "triaged", updatedAt: "2026-06-01T12:00:00.000Z" },
    history: [{ id: "h1" }],
    activity: [],
    statuses: ["new", "triaged", "planned", "in_progress", "done", "declined", "duplicate"],
  });
  mockIsSupportAdmin.mockReturnValue(false);
  setRequestDoc(bugNew);
  mockRunWithRefreshedFirebaseToken.mockImplementation(async (s: unknown, cb: (token: string) => unknown) => ({
    data: await cb("id-token"),
    session: s,
    refreshed: false,
  }));
});

describe("GET /api/support/requests/[id]", () => {
  it("requires support admin access", async () => {
    const res = await GET(req(null), ctx());
    expect(res.status).toBe(403);
  });

  it("returns request detail for support admins", async () => {
    mockIsSupportAdmin.mockReturnValue(true);
    const request = {
      nextUrl: { searchParams: new URLSearchParams("familyId=fam-1") },
    } as never;
    const res = await GET(request, ctx());
    expect(res.status).toBe(200);
    expect(mockLoadSupportRequestDetail).toHaveBeenCalledWith("fam-1", "req-1");
  });
});

describe("PATCH /api/support/requests/[id]", () => {
  it("requires a signed-in user", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const res = await PATCH(req({ subject: "x", description: "y", severity: "low" }), ctx());
    expect(res.status).toBe(401);
  });

  it("404s when the request is not owned by the caller", async () => {
    setRequestDoc({ ...bugNew, createdByUid: { stringValue: "someone-else" } });
    const res = await PATCH(req({ subject: "x", description: "y", severity: "low" }), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("support_request_not_found");
    expect(mockPatchDocument).not.toHaveBeenCalled();
  });

  it("409s when the request is no longer new", async () => {
    setRequestDoc({ ...bugNew, status: { stringValue: "in_progress" } });
    const res = await PATCH(req({ subject: "x", description: "y", severity: "low" }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_editable");
  });

  it("validates the edited fields", async () => {
    const res = await PATCH(req({ subject: "", description: "y", severity: "low" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("subject_required");
  });

  it("updates a bug report including severity", async () => {
    const res = await PATCH(
      req({ subject: "  New subject ", description: " New desc ", severity: "high" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const [path, fields, , mask] = mockPatchDocument.mock.calls[0];
    expect(path).toBe("families/fam-1/supportRequests/req-1");
    expect(fields.subject).toEqual({ stringValue: "New subject" });
    expect(fields.description).toEqual({ stringValue: "New desc" });
    expect(fields.severity).toEqual({ stringValue: "high" });
    expect(mask).toEqual(["subject", "description", "category", "updatedAt", "severity"]);
  });

  it("treats a legacy 'submitted' status as editable", async () => {
    setRequestDoc({ ...bugNew, status: { stringValue: "submitted" } });
    const res = await PATCH(
      req({ subject: "Edited", description: "Edited desc", severity: "low" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(mockPatchDocument).toHaveBeenCalledTimes(1);
  });

  it("updates a feature request without touching severity", async () => {
    setRequestDoc({ ...bugNew, type: { stringValue: "feature" } });
    const res = await PATCH(req({ subject: "Idea", description: "Please" }), ctx());
    expect(res.status).toBe(200);
    const [, fields, , mask] = mockPatchDocument.mock.calls[0];
    expect("severity" in fields).toBe(false);
    expect(mask).toEqual(["subject", "description", "category", "updatedAt"]);
  });

  it("lets support admins update status with history and audit", async () => {
    mockIsSupportAdmin.mockReturnValue(true);
    const res = await PATCH(req({ familyId: "fam-1", status: "triaged", note: "Reviewed" }), ctx());
    expect(res.status).toBe(200);
    expect(mockAdminCommitWrites).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/support/requests/[id] (user cancel)", () => {
  it("cancels (hides) an open own request without deleting it", async () => {
    const res = await DELETE(req(null), ctx());
    expect(res.status).toBe(200);
    const [path, fields, , mask] = mockPatchDocument.mock.calls[0];
    expect(path).toBe("families/fam-1/supportRequests/req-1");
    expect(fields.cancelledByUser).toEqual({ booleanValue: true });
    // Cancelling moves the request to the terminal "cancelled" status so the
    // support console no longer shows it as a new/actionable request.
    expect(fields.status).toEqual({ stringValue: "cancelled" });
    expect(fields.deleted).toBeUndefined();
    expect(mask).toEqual([
      "status",
      "cancelledByUser",
      "cancelledAt",
      "closedAt",
      "updatedAt",
    ]);
  });

  it("allows cancelling a request in any status (e.g. done)", async () => {
    setRequestDoc({ ...bugNew, status: { stringValue: "done" } });
    const res = await DELETE(req(null), ctx());
    expect(res.status).toBe(200);
    const [, fields, , mask] = mockPatchDocument.mock.calls[0];
    expect(fields.cancelledByUser).toEqual({ booleanValue: true });
    expect(fields.status).toEqual({ stringValue: "cancelled" });
    expect(mask).toEqual([
      "status",
      "cancelledByUser",
      "cancelledAt",
      "closedAt",
      "updatedAt",
    ]);
  });

  it("404s when the request is not owned by the caller", async () => {
    setRequestDoc({ ...bugNew, createdByUid: { stringValue: "other" } });
    const res = await DELETE(req(null), ctx());
    expect(res.status).toBe(404);
    expect(mockPatchDocument).not.toHaveBeenCalled();
  });
});
