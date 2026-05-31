import {
  DEFAULT_LOCALE,
  type AppLocale,
  normalizeLocale,
  resolveLocalePreference,
} from "@packages/locales";
import { readString, type FirestoreValue } from "@/lib/firestore/rest";

export { DEFAULT_LOCALE };

export function readLocale(
  fields: Record<string, FirestoreValue> | undefined,
  key = "locale",
): AppLocale | null {
  return normalizeLocale(readString(fields, key));
}

export function resolveAppLocale(input: {
  sessionLocale?: string | null;
  userLocale?: string | null;
  memberLocale?: string | null;
  familyLocale?: string | null;
}): AppLocale {
  return resolveLocalePreference({
    requestedLocale: input.sessionLocale || input.userLocale || input.memberLocale,
    familyLocale: input.familyLocale,
    fallbackLocale: DEFAULT_LOCALE,
  });
}
