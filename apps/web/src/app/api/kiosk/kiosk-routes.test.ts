import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enterKioskSession,
  type SessionIdentity,
  type SessionUser,
} from "@/lib/auth/session";

const mockGetSession = vi.fn();
const mockSetCookie = vi.fn();
const mockVerifyKioskPin = vi.fn();
const mockGetPrimaryFamilyId = vi.fn();
const mockResolveMember = vi.fn();
const mockEnsureManagedChildProfile = vi.fn();

vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: async (
    session: SessionUser,
    cb: (idToken: string) => Promise<unknown>,
  ) => ({ data: await cb("id-token"), session, refreshed: false }),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: () => mockGetSession(),
}));

vi.mock("@/lib/auth/session-cookie", () => ({
  setSessionUserCookie: (response: unknown, session: SessionUser) =>
    mockSetCookie(response, session),
}));

vi.mock("@/lib/auth/kiosk", () => ({
  verifyKioskPin: (...args: unknown[]) => mockVerifyKioskPin(...args),
}));

vi.mock("@/lib/auth/account-switch", () => ({
  normalizeAccountSwitchPin: (value: unknown) =>
    typeof value === "string" && /^\d{4}$/.test(value.trim()) ? value.trim() : "",
  getPrimaryFamilyIdForSession: (...args: unknown[]) => mockGetPrimaryFamilyId(...args),
  resolveFamilyMemberSessionIdentity: (...args: unknown[]) => mockResolveMember(...args),
  ensureManagedChildProfile: (...args: unknown[]) => mockEnsureManagedChildProfile(...args),
}));

const parentSession: SessionUser = {
  uid: "parent-uid",
  memberId: "parent-mid",
  role: "admin",
  email: "parent@example.com",
  name: "Parent",
  picture: "",
  locale: "en-US",
  firebaseIdToken: "id-token",
  firebaseRefreshToken: "refresh-token",
};

const child: SessionIdentity = {
  uid: "child-uid",
  memberId: "child-mid",
  role: "player",
  email: "child@example.com",
  name: "Child",
  picture: "",
  locale: "en-US",
};

function jsonRequest(body: unknown) {
  return { json: async () => body } as never;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockSetCookie.mockReset();
  mockVerifyKioskPin.mockReset();
  mockGetPrimaryFamilyId.mockReset();
  mockResolveMember.mockReset();
  mockEnsureManagedChildProfile.mockReset();
});

describe("POST /api/kiosk/start", () => {
  it("rejects an unauthenticated request", async () => {
    mockGetSession.mockReturnValue(null);
    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "child-mid" }));
    expect(response.status).toBe(401);
  });

  it("refuses to start when already in kiosk mode", async () => {
    mockGetSession.mockReturnValue(enterKioskSession(parentSession, child));
    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "child-mid" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("already_active");
  });

  it("requires a player id", async () => {
    mockGetSession.mockReturnValue(parentSession);
    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "" }));
    expect(response.status).toBe(400);
  });

  it("starts kiosk mode as the selected player after PIN verification", async () => {
    mockGetSession.mockReturnValue(parentSession);
    mockVerifyKioskPin.mockResolvedValue({ ok: true });
    mockGetPrimaryFamilyId.mockResolvedValue("fam-1");
    mockResolveMember.mockResolvedValue({ ...child, role: "player" });
    mockEnsureManagedChildProfile.mockResolvedValue({ ...child, role: "player" });

    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "child-mid", pin: "1234" }));

    expect(response.status).toBe(200);
    expect(mockSetCookie).toHaveBeenCalledTimes(1);
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.kioskActive).toBe(true);
    expect(savedSession.uid).toBe("child-uid");
    expect(savedSession.role).toBe("player");
    expect(savedSession.authUid).toBe("parent-uid");
  });

  it("approves a multi-selected roster and starts as the first player", async () => {
    mockGetSession.mockReturnValue(parentSession);
    mockVerifyKioskPin.mockResolvedValue({ ok: true });
    mockGetPrimaryFamilyId.mockResolvedValue("fam-1");
    mockResolveMember.mockResolvedValue({ ...child, role: "player" });
    mockEnsureManagedChildProfile.mockResolvedValue({ ...child, role: "player" });

    const { POST } = await import("./start/route");
    const response = await POST(
      jsonRequest({ playerIds: ["child-mid", "child2-mid", "child3-mid"], pin: "1234" }),
    );

    expect(response.status).toBe(200);
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.kioskActive).toBe(true);
    // Every selected member becomes part of the approved roster.
    expect(savedSession.kioskPlayerIds).toEqual(
      expect.arrayContaining(["child-mid", "child2-mid", "child3-mid"]),
    );
  });

  it("rejects a wrong PIN with 403", async () => {
    mockGetSession.mockReturnValue(parentSession);
    mockVerifyKioskPin.mockResolvedValue({ ok: false, reason: "invalid_pin" });

    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "child-mid", pin: "0000" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("invalid_pin");
  });

  it("allows a parent profile in kiosk mode with player-level permissions", async () => {
    mockGetSession.mockReturnValue(parentSession);
    mockVerifyKioskPin.mockResolvedValue({ ok: true });
    mockGetPrimaryFamilyId.mockResolvedValue("fam-1");
    mockResolveMember.mockResolvedValue({
      uid: "other-admin-uid",
      memberId: "other-admin",
      role: "admin",
      email: "other@example.com",
      name: "Other Parent",
      picture: "",
      locale: "en-US",
    });

    const { POST } = await import("./start/route");
    const response = await POST(jsonRequest({ playerId: "other-admin", pin: "1234" }));
    expect(response.status).toBe(200);
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.uid).toBe("other-admin-uid");
    expect(savedSession.role).toBe("player");
    expect(savedSession.kioskPlayerIds).toEqual(["other-admin"]);
  });
});

describe("POST /api/kiosk/switch", () => {
  // A kiosk session whose approved roster contains child-mid and child2-mid.
  const kioskSession = enterKioskSession(parentSession, child, ["child-mid", "child2-mid"]);

  it("requires an active kiosk session", async () => {
    mockGetSession.mockReturnValue(parentSession);
    const { POST } = await import("./switch/route");
    const response = await POST(jsonRequest({ playerId: "child2-mid" }));
    expect(response.status).toBe(409);
  });

  it("rejects switching to a player outside the approved roster (no PIN bypass)", async () => {
    mockGetSession.mockReturnValue(kioskSession);
    const { POST } = await import("./switch/route");
    const response = await POST(jsonRequest({ playerId: "stranger-mid" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("not_in_roster");
    // Roster enforcement happens before any family lookup.
    expect(mockGetPrimaryFamilyId).not.toHaveBeenCalled();
  });

  it("switches to a roster player without requiring a PIN", async () => {
    mockGetSession.mockReturnValue(kioskSession);
    mockGetPrimaryFamilyId.mockResolvedValue("fam-1");
    mockResolveMember.mockResolvedValue({ ...child, memberId: "child2-mid", role: "player" });
    mockEnsureManagedChildProfile.mockResolvedValue({
      ...child,
      uid: "child2-uid",
      memberId: "child2-mid",
      role: "player",
    });

    const { POST } = await import("./switch/route");
    const response = await POST(jsonRequest({ playerId: "child2-mid" }));

    expect(response.status).toBe(200);
    expect(mockVerifyKioskPin).not.toHaveBeenCalled();
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.kioskActive).toBe(true);
    expect(savedSession.uid).toBe("child2-uid");
    expect(savedSession.role).toBe("player");
    // Roster is preserved across the switch.
    expect(savedSession.kioskPlayerIds).toEqual(expect.arrayContaining(["child-mid", "child2-mid"]));
  });

  it("switches to a roster parent without requiring a PIN and keeps player-level permissions", async () => {
    const sessionWithParentRoster = enterKioskSession(parentSession, child, ["child-mid", "parent-mid"]);
    mockGetSession.mockReturnValue(sessionWithParentRoster);
    mockGetPrimaryFamilyId.mockResolvedValue("fam-1");
    mockResolveMember.mockResolvedValue({
      uid: "parent-uid",
      memberId: "parent-mid",
      role: "admin",
      email: "parent@example.com",
      name: "Parent",
      picture: "",
      locale: "en-US",
    });

    const { POST } = await import("./switch/route");
    const response = await POST(jsonRequest({ playerId: "parent-mid" }));

    expect(response.status).toBe(200);
    expect(mockVerifyKioskPin).not.toHaveBeenCalled();
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.kioskActive).toBe(true);
    expect(savedSession.uid).toBe("parent-uid");
    expect(savedSession.role).toBe("player");
    expect(savedSession.kioskPlayerIds).toEqual(expect.arrayContaining(["child-mid", "parent-mid"]));
  });
});

describe("POST /api/kiosk/stop", () => {
  it("requires an active kiosk session", async () => {
    mockGetSession.mockReturnValue(parentSession);
    const { POST } = await import("./stop/route");
    const response = await POST(jsonRequest({ pin: "1234" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_active");
  });

  it("requires the correct PIN to exit", async () => {
    mockGetSession.mockReturnValue(enterKioskSession(parentSession, child));
    mockVerifyKioskPin.mockResolvedValue({ ok: false, reason: "invalid_pin" });
    const { POST } = await import("./stop/route");
    const response = await POST(jsonRequest({ pin: "0000" }));
    expect(response.status).toBe(403);
  });

  it("restores the authenticated account on a valid exit", async () => {
    mockGetSession.mockReturnValue(enterKioskSession(parentSession, child));
    mockVerifyKioskPin.mockResolvedValue({ ok: true });
    const { POST } = await import("./stop/route");
    const response = await POST(jsonRequest({ pin: "1234" }));

    expect(response.status).toBe(200);
    const savedSession = mockSetCookie.mock.calls[0][1] as SessionUser;
    expect(savedSession.kioskActive).toBe(false);
    expect(savedSession.uid).toBe("parent-uid");
    expect(savedSession.role).toBe("admin");
  });
});
