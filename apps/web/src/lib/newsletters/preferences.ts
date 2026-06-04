import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@packages/locales";
import {
  boolField,
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

export async function getNewsletterPreferences(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return {
    locale: normalizeLocale(readString(userDoc.fields, "locale")) || DEFAULT_LOCALE,
    weeklyFamilyHighlightsEmail: readBoolean(userDoc.fields, WEEKLY_FAMILY_HIGHLIGHTS_FIELD),
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
