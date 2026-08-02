import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  runWithToken: vi.fn(),
  setCookie: vi.fn(),
  getContext: vi.fn(),
  getInvite: vi.fn(),
  listFriends: vi.fn(),
  findTarget: vi.fn(),
  notifyInvite: vi.fn(),
  commit: vi.fn(),
  create: vi.fn(),
  getDocument: vi.fn(),
  patch: vi.fn(),
  audit: vi.fn(),
  crossAudit: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mocks.getSession }));
vi.mock("@/lib/auth/firebase-refresh", () => ({ runWithRefreshedFirebaseToken: mocks.runWithToken }));
vi.mock("@/lib/auth/session-cookie", () => ({ setSessionUserCookie: mocks.setCookie }));
vi.mock("@/lib/family/member-access", () => ({ getViewerFamilyContext: mocks.getContext }));
vi.mock("@/lib/family-friends/repository", () => ({
  getFamilyFriendInvite: mocks.getInvite,
  listFamilyFriends: mocks.listFriends,
  findTargetAdminFamily: mocks.findTarget,
}));
vi.mock("@/lib/family-friends/notify", () => ({ notifyFamilyFriendInvite: mocks.notifyInvite }));
vi.mock("@/lib/firestore/admin", () => ({
  adminCommitWrites: mocks.commit,
  adminCreateOrReplaceDocument: mocks.create,
  adminGetDocument: mocks.getDocument,
  adminPatchDocument: mocks.patch,
}));
vi.mock("@/lib/audit/log", () => ({ writeAuditLogBestEffort: mocks.audit }));
vi.mock("@/lib/family-friends/audit", () => ({ writeCrossFamilyAuditBestEffort: mocks.crossAudit }));

const SESSION = {
  uid: "target-admin",
  email: "target@example.com",
  name: "Target Parent",
  firebaseIdToken: "token",
  firebaseRefreshToken: "refresh",
};

const INVITE = {
  id: "invite-1",
  status: "pending",
  fromFamilyId: "source-family",
  fromFamilyName: "Aaron's Family",
  fromAdminUid: "source-admin",
  fromAdminName: "Source Parent",
  fromAdminEmail: "source@example.com",
  toEmail: "target@example.com",
  toFamilyId: "target-family",
  tokenHash: "hash",
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2099-08-31T00:00:00.000Z",
  acceptedAt: "",
};

function request(email = SESSION.email) {
  mocks.getSession.mockReturnValue({ ...SESSION, email });
  return new Request("http://localhost/api/family-friends/invitations/invite-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept" }),
  }) as never;
}

describe("POST /api/family-friends/invitations/[inviteId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWithToken.mockImplementation(async (session, callback) => ({
      data: await callback("token"),
      session,
      refreshed: false,
    }));
    mocks.getContext.mockResolvedValue({
      familyId: "target-family",
      familyName: "Thomas's Family",
      viewerRole: "admin",
    });
    mocks.getInvite.mockResolvedValue(INVITE);
    mocks.listFriends.mockResolvedValue([]);
    mocks.commit.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(undefined);
    mocks.getDocument.mockResolvedValue({ fields: { defaultLocale: { stringValue: "en-US" } } });
  });

  it("requires the invited administrator's exact email", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("different@example.com"), { params: Promise.resolve({ inviteId: "invite-1" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "wrong_recipient" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("atomically creates both relationship documents and consumes the invite", async () => {
    const { POST } = await import("./route");
    const response = await POST(request(), { params: Promise.resolve({ inviteId: "invite-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "accepted" });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    const writes = mocks.commit.mock.calls[0][0] as Array<{ update?: { path?: string; updateMask?: string[] } }>;
    expect(writes.map((write) => write.update?.path)).toEqual([
      "families/source-family/friends/target-family",
      "families/target-family/friends/source-family",
      "familyFriendInvites/invite-1",
    ]);
    expect(writes[2].update?.updateMask).toContain("acceptedByUid");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ familyId: "target-family", eventType: "family_friend_accepted" }));
    expect(mocks.crossAudit).toHaveBeenCalledWith(expect.objectContaining({ familyId: "source-family", eventType: "family_friend_accepted" }));
  });

  it("does not overwrite an existing friendship", async () => {
    mocks.listFriends.mockImplementation(async (familyId: string) =>
      familyId === "source-family" ? [{ familyId: "target-family", familyName: "Thomas's Family", connectedAt: "" }] : [],
    );
    const { POST } = await import("./route");
    const response = await POST(request(), { params: Promise.resolve({ inviteId: "invite-1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_friends" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
