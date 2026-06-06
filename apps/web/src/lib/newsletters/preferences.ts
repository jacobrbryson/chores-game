import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@packages/locales";
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
  } satisfies NewsletterPreferenceSummary;
}

export async function updateNewsletterPreferences(input: {
  uid: string;
  idToken: string;
  weeklyFamilyHighlightsEmail: boolean;
}) {
  const now = new Date().toISOString();
  await patchDocument(
    `users/${input.uid}`,
    {
      [WEEKLY_FAMILY_HIGHLIGHTS_FIELD]: boolField(input.weeklyFamilyHighlightsEmail),
      preferencesUpdatedAt: timestampField(now),
    },
    input.idToken,
    [WEEKLY_FAMILY_HIGHLIGHTS_FIELD, "preferencesUpdatedAt"],
  );
  return {
    weeklyFamilyHighlightsEmail: input.weeklyFamilyHighlightsEmail,
  };
}
