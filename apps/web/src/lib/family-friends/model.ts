import { createHash, randomBytes } from "node:crypto";

export const FAMILY_FRIEND_INVITE_TTL_DAYS = 30;
export const MAX_FAMILY_FRIENDS = 25;

export type FamilyFriendInviteStatus = "pending" | "accepted" | "cancelled" | "expired";

export const FRIEND_FEED_KINDS = new Set([
  "chore_completed",
  "chore_approved",
  "routine_completed",
  "reward_claimed",
  "identity_title_unlocked",
  "family_reward_created",
]);

export function normalizeFriendEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isLikelyFriendEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeFriendEmail(value));
}

export function createFamilyFriendToken() {
  return randomBytes(32).toString("base64url");
}

export function hashFamilyFriendToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function familyFriendInviteExpiresAt(now = new Date()) {
  return new Date(now.getTime() + FAMILY_FRIEND_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isFamilyFriendInviteExpired(expiresAt: string, now = Date.now()) {
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= now;
}

export function firstNameOnly(value: string) {
  return value.trim().split(/\s+/)[0] || "Friend";
}

export function friendSafeMessage(message: string, actorName: string) {
  const firstName = firstNameOnly(actorName);
  if (!actorName.trim() || actorName.trim() === firstName) {
    return message;
  }
  return message.split(actorName.trim()).join(firstName);
}

export function canShareFriendFeedKind(kind: string, viewerRole: "admin" | "player") {
  if (!FRIEND_FEED_KINDS.has(kind)) {
    return false;
  }
  return kind !== "family_reward_created" || viewerRole === "admin";
}
