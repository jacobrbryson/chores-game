import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  normalizeDataRegion,
} from "@/lib/privacy/config";
import type {
  DataSummary,
  DataSummaryCategory,
  PrivacyOverview,
} from "@/lib/privacy/types";
import {
  readString,
  readTimestamp,
  type FirestoreValue,
} from "@/lib/firestore/rest";

type Fields = Record<string, FirestoreValue> | undefined;

// Builds the privacy overview from the family doc fields. Missing consent fields
// read as empty strings and data region defaults to US.
export function buildPrivacyOverview(
  familyFields: Fields,
  options?: { currentTermsVersion?: string; currentPrivacyVersion?: string },
): PrivacyOverview {
  const currentTermsVersion = options?.currentTermsVersion ?? CURRENT_TERMS_VERSION;
  const currentPrivacyVersion =
    options?.currentPrivacyVersion ?? CURRENT_PRIVACY_VERSION;

  const acceptedTermsVersion = readString(familyFields, "acceptedTermsVersion");
  const acceptedPrivacyVersion = readString(familyFields, "acceptedPrivacyVersion");
  const parentalConsentAt = readTimestamp(familyFields, "parentalConsentAt");
  const parentalConsentByUserId = readString(familyFields, "parentalConsentByUserId");

  const consentUpToDate =
    Boolean(parentalConsentAt) &&
    acceptedTermsVersion === currentTermsVersion &&
    acceptedPrivacyVersion === currentPrivacyVersion;

  return {
    acceptedTermsVersion,
    acceptedPrivacyVersion,
    parentalConsentAt,
    parentalConsentByUserId,
    dataRegion: normalizeDataRegion(readString(familyFields, "dataRegion")),
    familyCreatedAt: readTimestamp(familyFields, "createdAt"),
    // The family doc's updatedAt is the closest already-tracked "last activity"
    // signal; no new tracking field is introduced.
    lastActivityAt: readTimestamp(familyFields, "updatedAt"),
    deletionRequestedAt: readTimestamp(familyFields, "deletionRequestedAt"),
    deletionScheduledFor: readTimestamp(familyFields, "deletionScheduledFor"),
    currentTermsVersion,
    currentPrivacyVersion,
    consentUpToDate,
  };
}

// Canonical data-summary category order. Counts are filled in by the route from
// real data where practical; a null count renders as a safe static category.
export const DATA_SUMMARY_CATEGORY_KEYS = [
  "familyProfile",
  "parentAccounts",
  "childAccounts",
  "chores",
  "rewards",
  "achievements",
  "questProgress",
  "inventory",
  "feed",
  "apiTokens",
] as const;

export function buildDataSummary(counts: Record<string, number | null>): DataSummary {
  const categories: DataSummaryCategory[] = DATA_SUMMARY_CATEGORY_KEYS.map((key) => ({
    key,
    count: key in counts ? counts[key] : null,
  }));
  return { categories };
}

// Field-name patterns that must never leave the server in a family data export.
// Matched case-insensitively as substrings so variants (refreshToken,
// accessToken, tokenHash, subscriptionCiphertext, ...) are all redacted.
export const EXPORT_DENIED_FIELD_PATTERNS = [
  "password",
  "secret",
  "token",
  "hash",
  "ciphertext",
  "credential",
  "apikey",
] as const;

export function isSensitiveExportField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return EXPORT_DENIED_FIELD_PATTERNS.some((pattern) => lower.includes(pattern));
}

// Removes any sensitive keys from a plain (already JSON-decoded) record before it
// is included in a family export. Operates shallowly; export records are flat.
export function redactSensitiveFields<T extends Record<string, unknown>>(
  record: T,
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveExportField(key)) {
      continue;
    }
    result[key] = value;
  }
  return result as Partial<T>;
}
