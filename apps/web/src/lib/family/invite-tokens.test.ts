import { describe, expect, it } from "vitest";
import {
  buildFamilyInviteUrl,
  createFamilyInviteCode,
  evaluateFamilyInviteRedeemability,
  familyInviteCodeMatches,
  familyInviteExpiresAt,
  FAMILY_INVITE_MAX_ATTEMPTS,
  formatFamilyInviteCode,
  hashFamilyInviteCode,
  isFamilyInviteExpired,
  isValidFamilyInviteCodeShape,
  normalizeFamilyInviteCode,
} from "@/lib/family/invite-tokens";

describe("family invite codes", () => {
  it("generates codes of the expected shape", () => {
    for (let index = 0; index < 50; index += 1) {
      const code = createFamilyInviteCode();
      expect(code).toHaveLength(12);
      expect(isValidFamilyInviteCodeShape(code)).toBe(true);
      // Ambiguous characters must never be generated.
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => createFamilyInviteCode()));
    expect(codes.size).toBe(200);
  });

  it("normalizes what a human actually types", () => {
    const code = createFamilyInviteCode();
    const typed = `  ${formatFamilyInviteCode(code).toLowerCase()}  `;
    expect(normalizeFamilyInviteCode(typed)).toBe(code);
  });

  it("treats lookalike characters as their digit equivalents", () => {
    expect(normalizeFamilyInviteCode("I1L0O")).toBe("11100");
  });

  it("formats codes in readable groups", () => {
    expect(formatFamilyInviteCode("ABCD2345WXYZ")).toBe("ABCD-2345-WXYZ");
  });

  it("rejects codes of the wrong length", () => {
    expect(isValidFamilyInviteCodeShape("ABCD")).toBe(false);
    expect(isValidFamilyInviteCodeShape("")).toBe(false);
    expect(isValidFamilyInviteCodeShape(undefined)).toBe(false);
  });

  it("matches a code against its stored hash, and only that hash", () => {
    const code = createFamilyInviteCode();
    const storedHash = hashFamilyInviteCode(code);
    expect(familyInviteCodeMatches(formatFamilyInviteCode(code).toLowerCase(), storedHash)).toBe(true);
    expect(familyInviteCodeMatches(createFamilyInviteCode(), storedHash)).toBe(false);
  });

  it("never matches against an empty or malformed stored hash", () => {
    const code = createFamilyInviteCode();
    expect(familyInviteCodeMatches(code, "")).toBe(false);
    expect(familyInviteCodeMatches(code, "not-a-hash")).toBe(false);
  });

  it("does not store the raw code", () => {
    const code = createFamilyInviteCode();
    expect(hashFamilyInviteCode(code)).not.toContain(code);
    expect(hashFamilyInviteCode(code)).toHaveLength(64);
  });
});

describe("family invite expiry", () => {
  it("expires 30 days out", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");
    expect(familyInviteExpiresAt(now)).toBe("2026-09-12T00:00:00.000Z");
  });

  it("detects expiry", () => {
    const now = Date.parse("2026-08-13T00:00:00.000Z");
    expect(isFamilyInviteExpired("2026-08-12T00:00:00.000Z", now)).toBe(true);
    expect(isFamilyInviteExpired("2026-08-14T00:00:00.000Z", now)).toBe(false);
    expect(isFamilyInviteExpired("", now)).toBe(true);
    expect(isFamilyInviteExpired("garbage", now)).toBe(true);
  });
});

describe("family invite redeemability", () => {
  const future = "2026-12-01T00:00:00.000Z";
  const now = Date.parse("2026-08-13T00:00:00.000Z");

  it("accepts a pending, unexpired invite", () => {
    expect(evaluateFamilyInviteRedeemability({ status: "pending", expiresAt: future }, now)).toEqual({
      ok: true,
    });
  });

  it("rejects a missing invite", () => {
    expect(evaluateFamilyInviteRedeemability(null, now)).toEqual({
      ok: false,
      reason: "invite_not_found",
    });
  });

  it("rejects a single-use invite that was already redeemed", () => {
    expect(
      evaluateFamilyInviteRedeemability({ status: "accepted", expiresAt: future }, now),
    ).toEqual({ ok: false, reason: "invite_already_used" });
  });

  it("rejects a revoked invite", () => {
    expect(evaluateFamilyInviteRedeemability({ status: "revoked", expiresAt: future }, now)).toEqual({
      ok: false,
      reason: "invite_revoked",
    });
  });

  it("rejects an expired invite", () => {
    expect(
      evaluateFamilyInviteRedeemability(
        { status: "pending", expiresAt: "2026-01-01T00:00:00.000Z" },
        now,
      ),
    ).toEqual({ ok: false, reason: "invite_expired" });
  });

  it("locks an invite out after too many failed attempts", () => {
    expect(
      evaluateFamilyInviteRedeemability(
        { status: "pending", expiresAt: future, attemptCount: FAMILY_INVITE_MAX_ATTEMPTS },
        now,
      ),
    ).toEqual({ ok: false, reason: "invite_locked" });
  });
});

describe("family invite links", () => {
  it("builds an absolute link when an app URL is configured", () => {
    expect(buildFamilyInviteUrl("abcd2345wxyz", "https://example.test/")).toBe(
      "https://example.test/join?code=ABCD2345WXYZ",
    );
  });

  it("falls back to a relative link", () => {
    expect(buildFamilyInviteUrl("ABCD2345WXYZ", "")).toBe("/join?code=ABCD2345WXYZ");
  });
});
