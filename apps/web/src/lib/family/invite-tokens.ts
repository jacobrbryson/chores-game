import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  normalizeFamilyInviteCode,
} from "@/lib/family/invite-code-format";

// Re-exported so server code has one import site for the whole invite-code
// vocabulary. Browser code must import from `invite-code-format` directly —
// this module pulls in node:crypto.
export {
  buildFamilyInviteUrl,
  formatFamilyInviteCode,
  isValidFamilyInviteCodeShape,
  normalizeFamilyInviteCode,
} from "@/lib/family/invite-code-format";

/**
 * Family invite codes: the join mechanism that does not depend on email
 * equality.
 *
 * An invitation gets a generated invite id plus a single-use expiring code.
 * The code is the secret; only its SHA-256 hash is persisted, mirroring the
 * expiring-token pattern already established in `lib/family-friends`. The same
 * code is what an invite link carries, so "type the code" and "tap the link"
 * are one credential with two presentations.
 *
 * Classification: invite records and invited emails are ADMIN_ONLY. The raw
 * code is SYSTEM_SECRET and is returned to the inviting parent exactly once,
 * at creation, and never read back out of Firestore.
 */

export const FAMILY_INVITE_TTL_DAYS = 30;
/** Redemption attempts allowed against one invite before it is locked out. */
export const FAMILY_INVITE_MAX_ATTEMPTS = 10;

export type FamilyInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function createFamilyInviteId() {
  return randomUUID();
}

/**
 * Generates a 12-character code (~60 bits). Bytes that would bias the modulo
 * are rejected rather than folded, so every character is uniformly distributed.
 */
export function createFamilyInviteCode() {
  const limit = 256 - (256 % INVITE_CODE_ALPHABET.length);
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of randomBytes(INVITE_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }
  return code;
}

export function hashFamilyInviteCode(code: string) {
  return createHash("sha256").update(normalizeFamilyInviteCode(code)).digest("hex");
}

/** Constant-time hash comparison, so redemption cannot be timed character by character. */
export function familyInviteCodeMatches(code: string, storedHash: string) {
  const candidate = Buffer.from(hashFamilyInviteCode(code), "hex");
  const expected = Buffer.from(storedHash ?? "", "hex");
  if (candidate.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(candidate, expected);
}

export function familyInviteExpiresAt(now = new Date()) {
  return new Date(now.getTime() + FAMILY_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isFamilyInviteExpired(expiresAt: string, now = Date.now()) {
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= now;
}

export type FamilyInviteRedeemability = {
  status: FamilyInviteStatus;
  expiresAt: string;
  attemptCount?: number;
};

export type FamilyInviteRejection =
  | "invite_not_found"
  | "invite_already_used"
  | "invite_revoked"
  | "invite_expired"
  | "invite_locked";

/**
 * Single place that decides whether an invite may still be redeemed, so the
 * API route, the support console and the tests all agree.
 */
export function evaluateFamilyInviteRedeemability(
  invite: FamilyInviteRedeemability | null,
  now = Date.now(),
): { ok: true } | { ok: false; reason: FamilyInviteRejection } {
  if (!invite) return { ok: false, reason: "invite_not_found" };
  if (invite.status === "accepted") return { ok: false, reason: "invite_already_used" };
  if (invite.status === "revoked") return { ok: false, reason: "invite_revoked" };
  if ((invite.attemptCount ?? 0) >= FAMILY_INVITE_MAX_ATTEMPTS) {
    return { ok: false, reason: "invite_locked" };
  }
  if (invite.status === "expired" || isFamilyInviteExpired(invite.expiresAt, now)) {
    return { ok: false, reason: "invite_expired" };
  }
  return { ok: true };
}
