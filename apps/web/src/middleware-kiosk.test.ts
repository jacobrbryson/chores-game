import { beforeAll, describe, expect, it } from "vitest";
import { readKioskActiveFromCookie } from "./middleware";
import {
  createSessionToken,
  enterKioskSession,
  type SessionIdentity,
  type SessionUser,
} from "@/lib/auth/session";

beforeAll(() => {
  process.env.SESSION_SECRET = "kiosk-middleware-test-secret-0123456789";
});

const parentSession: SessionUser = {
  uid: "parent-uid",
  memberId: "parent-mid",
  role: "admin",
  email: "parent@example.com",
  name: "Parent",
  picture: "",
  locale: "en-US",
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

describe("readKioskActiveFromCookie (middleware kiosk lock)", () => {
  it("detects a kiosk-active session cookie", () => {
    const token = createSessionToken(enterKioskSession(parentSession, child, ["child-mid"]));
    expect(readKioskActiveFromCookie(token ?? undefined)).toBe(true);
  });

  it("returns false for a normal (non-kiosk) session cookie", () => {
    const token = createSessionToken(parentSession);
    expect(readKioskActiveFromCookie(token ?? undefined)).toBe(false);
  });

  it("returns false for a missing or malformed cookie", () => {
    expect(readKioskActiveFromCookie(undefined)).toBe(false);
    expect(readKioskActiveFromCookie("")).toBe(false);
    expect(readKioskActiveFromCookie("not-a-token")).toBe(false);
  });

  it("does not require the HMAC signature to be valid (UX gate only)", () => {
    const token = createSessionToken(enterKioskSession(parentSession, child, ["child-mid"]));
    const [payload] = (token ?? "").split(".");
    // Tampered/missing signature still reads the flag — server routes remain the
    // real authority; this only drives the redirect.
    expect(readKioskActiveFromCookie(`${payload}.bogus-signature`)).toBe(true);
  });
});
