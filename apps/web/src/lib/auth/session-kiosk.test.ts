import { beforeAll, describe, expect, it } from "vitest";
import {
  createSessionToken,
  enterKioskSession,
  exitKioskSession,
  getAuthenticatedSessionIdentity,
  getSessionIdentity,
  isKioskActive,
  isSessionSwitched,
  parseSessionToken,
  type SessionIdentity,
  type SessionUser,
} from "./session";

beforeAll(() => {
  // createSessionToken / parseSessionToken require a >= 32 char signing secret.
  process.env.SESSION_SECRET = "kiosk-test-session-secret-0123456789";
});

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

const childA: SessionIdentity = {
  uid: "childA-uid",
  memberId: "childA-mid",
  role: "player",
  email: "childa@example.com",
  name: "Child A",
  picture: "",
  locale: "en-US",
};

const childB: SessionIdentity = {
  uid: "childB-uid",
  memberId: "childB-mid",
  role: "player",
  email: "childb@example.com",
  name: "Child B",
  picture: "",
  locale: "en-US",
};

describe("kiosk session transitions", () => {
  it("lets a parent enter kiosk mode as a player while preserving the authenticated admin", () => {
    const kiosk = enterKioskSession(parentSession, childA);

    expect(isKioskActive(kiosk)).toBe(true);
    // Current identity is always the selected player while kiosk is active.
    expect(getSessionIdentity(kiosk).role).toBe("player");
    expect(getSessionIdentity(kiosk).uid).toBe("childA-uid");
    // The authenticated account (and its real admin role) is preserved but never
    // becomes the active identity.
    expect(getAuthenticatedSessionIdentity(kiosk).role).toBe("admin");
    expect(getAuthenticatedSessionIdentity(kiosk).uid).toBe("parent-uid");
    expect(isSessionSwitched(kiosk)).toBe(true);
  });

  it("forces player-level permissions even when the authenticated user is an admin", () => {
    const kiosk = enterKioskSession(parentSession, { ...childA, role: "admin" });
    // Even if a malformed identity claimed admin, kiosk pins the active role to player.
    expect(getSessionIdentity(kiosk).role).toBe("player");
  });

  it("lets a player enter kiosk mode (entry is not admin-only)", () => {
    const playerSession: SessionUser = {
      ...parentSession,
      uid: "player-uid",
      memberId: "player-mid",
      role: "player",
      email: "player@example.com",
      name: "Player",
    };
    const kiosk = enterKioskSession(playerSession, childA);
    expect(isKioskActive(kiosk)).toBe(true);
    expect(getSessionIdentity(kiosk).uid).toBe("childA-uid");
    expect(getAuthenticatedSessionIdentity(kiosk).uid).toBe("player-uid");
  });

  it("keeps the authenticated account when switching players within kiosk mode", () => {
    const first = enterKioskSession(parentSession, childA, ["childA-mid", "childB-mid"]);
    // Switching preserves the approved roster passed through enterKioskSession.
    const second = enterKioskSession(first, childB, first.kioskPlayerIds);

    expect(isKioskActive(second)).toBe(true);
    expect(getSessionIdentity(second).uid).toBe("childB-uid");
    // Switching players must NOT re-point the authenticated identity at child A.
    expect(getAuthenticatedSessionIdentity(second).uid).toBe("parent-uid");
    expect(getAuthenticatedSessionIdentity(second).role).toBe("admin");
    expect(second.kioskPlayerIds).toEqual(["childA-mid", "childB-mid"]);
  });

  it("stores the approved multi-select roster and clears it on exit", () => {
    const kiosk = enterKioskSession(parentSession, childA, ["childA-mid", "childB-mid"]);
    expect(kiosk.kioskPlayerIds).toContain("childA-mid");
    expect(kiosk.kioskPlayerIds).toContain("childB-mid");
    const exited = exitKioskSession(kiosk);
    expect(exited.kioskPlayerIds).toBeUndefined();
  });

  it("restores the authenticated account and clears kiosk on exit", () => {
    const kiosk = enterKioskSession(parentSession, childA);
    const exited = exitKioskSession(kiosk);

    expect(isKioskActive(exited)).toBe(false);
    expect(isSessionSwitched(exited)).toBe(false);
    expect(getSessionIdentity(exited).uid).toBe("parent-uid");
    expect(getSessionIdentity(exited).role).toBe("admin");
    expect(exited.authUid).toBeUndefined();
  });

  it("persists the kiosk flag through the signed session token", () => {
    const kiosk = enterKioskSession(parentSession, childA);
    const token = createSessionToken(kiosk);
    expect(token).toBeTruthy();
    const parsed = parseSessionToken(token ?? undefined);
    expect(parsed?.kioskActive).toBe(true);
    expect(parsed && getSessionIdentity(parsed).uid).toBe("childA-uid");
    expect(parsed && getAuthenticatedSessionIdentity(parsed).uid).toBe("parent-uid");
  });

  it("clears the kiosk flag in the token after exit (logout/switch user resets state)", () => {
    const exited = exitKioskSession(enterKioskSession(parentSession, childA));
    const parsed = parseSessionToken(createSessionToken(exited) ?? undefined);
    expect(parsed?.kioskActive).toBe(false);
  });
});
