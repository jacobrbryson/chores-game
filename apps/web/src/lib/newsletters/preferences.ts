import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@packages/locales";
import {
  FAMILY_FRIEND_INVITE_EMAIL_FIELD,
  resolveFamilyFriendInviteEmailPreference,
} from "@/lib/email/preferences";
import {
  boolField,
  type FirestoreValue,
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  timestampField,
} from "@/lib/firestore/rest";

export const WEEKLY_FAMILY_HIGHLIGHTS_FIELD = "weeklyFamilyHighlightsEmail";

export type NewsletterPreferenceSummary = {
  locale: AppLocale;
  weeklyFamilyHighlightsEmail: boolean;
  familyFriendInviteEmail: boolean;
};

export function resolveWeeklyFamilyHighlightsEmailPreference(
  fields: Record<string, FirestoreValue> | undefined,
) {
  if (!fields || !(WEEKLY_FAMILY_HIGHLIGHTS_FIELD in fields)) {
    return true;
  }
  return readBoolean(fields, WEEKLY_FAMILY_HIGHLIGHTS_FIELD);
}

export async function getNewsletterPreferences(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return {
    locale: normalizeLocale(readString(userDoc.fields, "locale")) || DEFAULT_LOCALE,
    weeklyFamilyHighlightsEmail: resolveWeeklyFamilyHighlightsEmailPreference(userDoc.fields),
    familyFriendInviteEmail: resolveFamilyFriendInviteEmailPreference(userDoc.fields),
  } satisfies NewsletterPreferenceSummary;
}

export async function updateNewsletterPreferences(input: {
  uid: string;
  idToken: string;
  weeklyFamilyHighlightsEmail?: boolean;
  familyFriendInviteEmail?: boolean;
}) {
  const now = new Date().toISOString();
  const fields: Record<string, FirestoreValue> = { preferencesUpdatedAt: timestampField(now) };
  if (typeof input.weeklyFamilyHighlightsEmail === "boolean") {
    fields[WEEKLY_FAMILY_HIGHLIGHTS_FIELD] = boolField(input.weeklyFamilyHighlightsEmail);
  }
  if (typeof input.familyFriendInviteEmail === "boolean") {
    fields[FAMILY_FRIEND_INVITE_EMAIL_FIELD] = boolField(input.familyFriendInviteEmail);
  }
  // Only the toggles present in the request are written, so a partial update
  // never resets the preference the caller did not touch. The PATCH response
  // carries the merged document, so both values can be echoed back without a
  // second read.
  const updated = await patchDocument(`users/${input.uid}`, fields, input.idToken, Object.keys(fields));
  return {
    weeklyFamilyHighlightsEmail: resolveWeeklyFamilyHighlightsEmailPreference(updated.fields),
    familyFriendInviteEmail: resolveFamilyFriendInviteEmailPreference(updated.fields),
  };
}
