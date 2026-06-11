import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterKioskSession, type SessionIdentity, type SessionUser } from "./session";

const mockGetDocument = vi.fn();
const mockVerifyAccountSwitchPin = vi.fn();

vi.mock("@/lib/firestore/rest", () => ({
  getDocument: (path: string, idToken: string) => mockGetDocument(path, idToken),
  readString: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "string" ? value : "";
  },
}));

vi.mock("@/lib/auth/account-switch", () => ({
  verifyAccountSwitchPin: (uid: string, pin: string, idToken: string) =>
    mockVerifyAccountSwitchPin(uid, pin, idToken),
}));

import {
  APP_EVENT_SOURCE,
  KIOSK_EVENT_SOURCE,
  buildKioskActivityMetadata,
  verifyKioskPin,
} from "./kiosk";

beforeEach(() => {
  mockGetDocument.mockReset();
  mockVerifyAccountSwitchPin.mockReset();
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

describe("verifyKioskPin", () => {
  it("passes without a PIN when none is configured", async () => {
    mockGetDocument.mockResolvedValue({ fields: {} });
    const result = await verifyKioskPin("parent-uid", "", "tok");
    expect(result.ok).toBe(true);
    expect(mockVerifyAccountSwitchPin).not.toHaveBeenCalled();
  });

  it("accepts the correct PIN when one is configured", async () => {
    mockGetDocument.mockResolvedValue({ fields: { accountSwitchPinHash: "hash" } });
    mockVerifyAccountSwitchPin.mockResolvedValue({ ok: true });
    const result = await verifyKioskPin("parent-uid", "1234", "tok");
    expect(result.ok).toBe(true);
    expect(mockVerifyAccountSwitchPin).toHaveBeenCalledWith("parent-uid", "1234", "tok");
  });

  it("rejects an incorrect PIN when one is configured", async () => {
    mockGetDocument.mockResolvedValue({ fields: { accountSwitchPinHash: "hash" } });
    mockVerifyAccountSwitchPin.mockResolvedValue({ ok: false, reason: "invalid_pin" });
    const result = await verifyKioskPin("parent-uid", "0000", "tok");
    expect(result).toEqual({ ok: false, reason: "invalid_pin" });
  });
});

describe("buildKioskActivityMetadata", () => {
  it("tags kiosk completions with source=kiosk, the player, and the authenticated user", () => {
    const kiosk = enterKioskSession(parentSession, child);
    const meta = buildKioskActivityMetadata(kiosk, "child-uid");
    expect(meta.source).toBe(KIOSK_EVENT_SOURCE);
    // The signed-in parent is recorded separately from the player it was for.
    expect(meta.authenticatedUid).toBe("parent-uid");
    expect(meta.completedForPlayerId).toBe("child-uid");
  });

  it("uses source=app and the acting user for normal (non-kiosk) completions", () => {
    const meta = buildKioskActivityMetadata(parentSession, "parent-uid");
    expect(meta.source).toBe(APP_EVENT_SOURCE);
    expect(meta.authenticatedUid).toBe("parent-uid");
    expect(meta.completedForPlayerId).toBe("parent-uid");
  });
});
