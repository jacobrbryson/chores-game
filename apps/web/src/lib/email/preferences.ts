import { adminGetDocument } from "@/lib/firestore/admin";
import { readBoolean, type FirestoreValue } from "@/lib/firestore/rest";

/**
 * Per-user email opt-outs stored on `users/{uid}`. Each preference defaults to
 * enabled when the field is absent so existing accounts keep receiving mail
 * they never opted out of.
 */
export const FAMILY_FRIEND_INVITE_EMAIL_FIELD = "familyFriendInviteEmail";

export function resolveFamilyFriendInviteEmailPreference(
  fields: Record<string, FirestoreValue> | undefined,
) {
  if (!fields || !(FAMILY_FRIEND_INVITE_EMAIL_FIELD in fields)) {
    return true;
  }
  return readBoolean(fields, FAMILY_FRIEND_INVITE_EMAIL_FIELD);
}

/**
 * Reads the recipient's opt-out with service-account credentials. The inviter
 * sends this email, so the caller's ID token cannot read the recipient's user
 * document. A read failure falls back to enabled — a missed opt-out is better
 * than silently dropping an invitation.
 */
export async function isFamilyFriendInviteEmailEnabled(uid: string) {
  if (!uid) {
    return true;
  }
  try {
    const doc = await adminGetDocument(`users/${uid}`);
    return resolveFamilyFriendInviteEmailPreference(doc.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.warn("[FAMILY_FRIEND_INVITE_EMAIL_PREFERENCE_UNAVAILABLE]", reason);
    return true;
  }
}
