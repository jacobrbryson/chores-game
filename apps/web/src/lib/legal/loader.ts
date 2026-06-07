// Shared legal document loader.
//
// The JSON files in apps/web/src/legal/ are the canonical source for legal
// document content and version strings. Env vars can override the version for
// emergency bumps without a code deploy, but the JSON file version is the
// default and should match the deployed content at all times.

import privacyPolicyData from "@/legal/privacy-policy.json";
import termsData from "@/legal/terms-of-service.json";

export type LegalDocumentLink = {
  text: string;
  href: string;
};

export type LegalDocumentSection = {
  heading: string;
  body?: string[];
  items?: string[];
  links?: LegalDocumentLink[];
};

export type LegalDocument = {
  id: string;
  title: string;
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  requiresReacceptance: boolean;
  sections: LegalDocumentSection[];
};

const privacyPolicy = privacyPolicyData as LegalDocument;
const termsOfService = termsData as LegalDocument;

export function getPrivacyPolicy(): LegalDocument {
  return privacyPolicy;
}

export function getTermsOfService(): LegalDocument {
  return termsOfService;
}

// Env vars can override the version string for operational bumps without a
// code deploy. The JSON file version is the fallback and canonical default.
export function getCurrentPrivacyPolicyVersion(): string {
  return process.env.CURRENT_PRIVACY_VERSION?.trim() || privacyPolicy.version;
}

export function getCurrentTermsVersion(): string {
  return process.env.CURRENT_TERMS_VERSION?.trim() || termsOfService.version;
}
