// Privacy / consent configuration constants.
//
// Legal document versions are sourced from the versioned JSON files in
// apps/web/src/legal/ via the shared legal loader. Env vars can override for
// emergency bumps without a code deploy. All other code should import
// CURRENT_TERMS_VERSION and CURRENT_PRIVACY_VERSION from here to avoid
// duplicating the version logic.

import {
  getCurrentPrivacyPolicyVersion,
  getCurrentTermsVersion,
} from "@/lib/legal/loader";

export const CURRENT_TERMS_VERSION = getCurrentTermsVersion();
export const CURRENT_PRIVACY_VERSION = getCurrentPrivacyPolicyVersion();

// Default data region for a family when none is recorded yet.
export const DEFAULT_DATA_REGION = "US";
export const SUPPORTED_DATA_REGIONS = ["US", "EU", "UK", "CA", "AU"] as const;
export type DataRegion = (typeof SUPPORTED_DATA_REGIONS)[number];

export function normalizeDataRegion(value: unknown): DataRegion {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if ((SUPPORTED_DATA_REGIONS as readonly string[]).includes(upper)) {
      return upper as DataRegion;
    }
  }
  return DEFAULT_DATA_REGION;
}

// Family deletion is never an immediate hard delete. A request schedules
// deletion 30 days out, and parents can cancel any time during the grace
// period. See SERVER-SIDE TODO in the deletion route — actual purge is not yet
// implemented; the workflow only records intent so it can be honored later.
export const DELETION_GRACE_PERIOD_DAYS = 30;

export function deletionScheduledForFrom(requestedAtIso: string): string {
  const requestedAt = new Date(requestedAtIso);
  const scheduled = new Date(
    requestedAt.getTime() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );
  return scheduled.toISOString();
}
