import type { DataRegion } from "@/lib/privacy/config";

export type PrivacyOverview = {
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
  acceptedLegalVersion: string;
  parentalConsentAt: string;
  parentalConsentByUserId: string;
  parentalConsentByDisplayName: string;
  dataRegion: DataRegion;
  familyCreatedAt: string;
  lastActivityAt: string;
  deletionRequestedAt: string;
  deletionScheduledFor: string;
  // Current authoritative versions so the UI can flag stale/missing consent.
  currentTermsVersion: string;
  currentPrivacyVersion: string;
  currentLegalVersion: string;
  consentUpToDate: boolean;
};

export type DataSummaryCategory = {
  key: string;
  count: number | null;
};

export type DataSummary = {
  categories: DataSummaryCategory[];
};

// Immutable record of a single consent acceptance event.
export type ConsentEvent = {
  id: string;
  familyId: string;
  userId: string;
  eventType: string;
  documentType: string;
  documentVersion: string;
  acceptedAt: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
};

export type PrivacyResponse = {
  noFamily: boolean;
  viewerRole: "admin" | "player";
  overview: PrivacyOverview;
  dataSummary: DataSummary;
  consentHistory: ConsentEvent[];
};

// Audit event types for sensitive privacy actions.
export const PRIVACY_AUDIT_EVENTS = {
  dataExportRequested: "privacy_data_export_requested",
  deletionRequested: "privacy_deletion_requested",
  deletionCanceled: "privacy_deletion_canceled",
  consentRecorded: "privacy_consent_recorded",
} as const;

// Immutable consent event types stored in families/{familyId}/consentEvents.
export const CONSENT_EVENT_TYPES = {
  termsAccepted: "TERMS_ACCEPTED",
  privacyAccepted: "PRIVACY_ACCEPTED",
  parentalConsentRecorded: "PARENTAL_CONSENT_RECORDED",
  consentWithdrawn: "CONSENT_WITHDRAWN",
} as const;

export const CONSENT_DOCUMENT_TYPES = {
  terms: "TERMS",
  privacyPolicy: "PRIVACY_POLICY",
  parentalConsent: "PARENTAL_CONSENT",
} as const;
