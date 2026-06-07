import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  DELETION_GRACE_PERIOD_DAYS,
  deletionScheduledForFrom,
  normalizeDataRegion,
} from "@/lib/privacy/config";
import {
  getLegalDocumentByVersion,
  getCurrentPrivacyPolicyVersion,
  getCurrentTermsVersion,
  getPrivacyPolicy,
  getTermsOfService,
} from "@/lib/legal/loader";
import {
  buildDataSummary,
  buildPrivacyOverview,
  isSensitiveExportField,
  redactSensitiveFields,
} from "@/lib/privacy/service";
import {
  EXPORT_MANIFEST_NOTES,
  sanitizeChoreForExport,
  sanitizeFamilyForExport,
  sanitizeFeedItemForExport,
  sanitizeInviteForExport,
  sanitizeMemberForExport,
  sanitizeRewardForExport,
} from "@/lib/privacy/export-sanitizers";
import {
  CONSENT_DOCUMENT_TYPES,
  CONSENT_EVENT_TYPES,
} from "@/lib/privacy/types";
import type { FirestoreValue } from "@/lib/firestore/rest";

describe("deletion scheduling", () => {
  it("schedules deletion exactly 30 days after the request", () => {
    const requestedAt = "2026-06-06T00:00:00.000Z";
    const scheduled = deletionScheduledForFrom(requestedAt);
    const diffDays =
      (new Date(scheduled).getTime() - new Date(requestedAt).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(DELETION_GRACE_PERIOD_DAYS);
    expect(diffDays).toBe(30);
  });
});

describe("data region", () => {
  it("defaults to US for unknown/empty input", () => {
    expect(normalizeDataRegion("")).toBe("US");
    expect(normalizeDataRegion(undefined)).toBe("US");
    expect(normalizeDataRegion("mars")).toBe("US");
  });

  it("normalizes valid regions to uppercase", () => {
    expect(normalizeDataRegion("eu")).toBe("EU");
    expect(normalizeDataRegion("Uk")).toBe("UK");
  });
});

describe("export redaction", () => {
  it("flags secret-bearing field names", () => {
    for (const field of [
      "password",
      "tokenHash",
      "googleTasksRefreshToken",
      "subscriptionCiphertext",
      "apiKey",
      "oauthSecret",
    ]) {
      expect(isSensitiveExportField(field)).toBe(true);
    }
  });

  it("keeps ordinary fields", () => {
    for (const field of ["name", "coinValue", "createdAt", "status"]) {
      expect(isSensitiveExportField(field)).toBe(false);
    }
  });

  it("strips sensitive keys from an export record", () => {
    const redacted = redactSensitiveFields({
      name: "Avery",
      walletBalance: 10,
      googleTasksRefreshToken: "super-secret",
      subscriptionCiphertext: "encrypted",
      password: "nope",
    });
    expect(redacted).toEqual({ name: "Avery", walletBalance: 10 });
  });
});

describe("privacy overview", () => {
  it("marks consent up to date only when versions match and a timestamp exists", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: CURRENT_TERMS_VERSION },
      acceptedPrivacyVersion: { stringValue: CURRENT_PRIVACY_VERSION },
      parentalConsentAt: { timestampValue: "2026-06-06T00:00:00.000Z" },
    };
    const overview = buildPrivacyOverview(fields);
    expect(overview.consentUpToDate).toBe(true);
    expect(overview.acceptedLegalVersion).toBe(CURRENT_TERMS_VERSION);
    expect(overview.currentLegalVersion).toBe(CURRENT_TERMS_VERSION);
    expect(overview.dataRegion).toBe("US");
  });

  it("is not up to date when consent is missing", () => {
    const overview = buildPrivacyOverview({});
    expect(overview.consentUpToDate).toBe(false);
    expect(overview.acceptedTermsVersion).toBe("");
    expect(overview.acceptedLegalVersion).toBe("");
    expect(overview.dataRegion).toBe("US");
  });

  it("is not up to date when the accepted version is stale", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: "1900-01-01" },
      acceptedPrivacyVersion: { stringValue: CURRENT_PRIVACY_VERSION },
      parentalConsentAt: { timestampValue: "2026-06-06T00:00:00.000Z" },
    };
    expect(buildPrivacyOverview(fields).consentUpToDate).toBe(false);
  });

  it("reads parentalConsentByUserId from the family doc", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: CURRENT_TERMS_VERSION },
      acceptedPrivacyVersion: { stringValue: CURRENT_PRIVACY_VERSION },
      parentalConsentAt: { timestampValue: "2026-06-06T00:00:00.000Z" },
      parentalConsentByUserId: { stringValue: "uid-parent-123" },
    };
    const overview = buildPrivacyOverview(fields);
    expect(overview.parentalConsentByUserId).toBe("uid-parent-123");
    expect(overview.consentUpToDate).toBe(true);
  });

  it("returns empty string for parentalConsentByUserId when absent", () => {
    const overview = buildPrivacyOverview({});
    expect(overview.parentalConsentByUserId).toBe("");
  });
});

describe("consent event constants", () => {
  it("exposes the expected event type values", () => {
    expect(CONSENT_EVENT_TYPES.termsAccepted).toBe("TERMS_ACCEPTED");
    expect(CONSENT_EVENT_TYPES.privacyAccepted).toBe("PRIVACY_ACCEPTED");
    expect(CONSENT_EVENT_TYPES.parentalConsentRecorded).toBe("PARENTAL_CONSENT_RECORDED");
    expect(CONSENT_EVENT_TYPES.consentWithdrawn).toBe("CONSENT_WITHDRAWN");
  });

  it("exposes the expected document type values", () => {
    expect(CONSENT_DOCUMENT_TYPES.terms).toBe("TERMS");
    expect(CONSENT_DOCUMENT_TYPES.privacyPolicy).toBe("PRIVACY_POLICY");
    expect(CONSENT_DOCUMENT_TYPES.parentalConsent).toBe("PARENTAL_CONSENT");
  });

  it("re-acceptance is required when terms version differs from current", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: "2020-01-01" },
      acceptedPrivacyVersion: { stringValue: CURRENT_PRIVACY_VERSION },
      parentalConsentAt: { timestampValue: "2026-06-06T00:00:00.000Z" },
    };
    const overview = buildPrivacyOverview(fields);
    expect(overview.consentUpToDate).toBe(false);
    expect(overview.acceptedTermsVersion).toBe("2020-01-01");
    expect(overview.currentTermsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("re-acceptance is required when privacy version differs from current", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: CURRENT_TERMS_VERSION },
      acceptedPrivacyVersion: { stringValue: "2020-01-01" },
      parentalConsentAt: { timestampValue: "2026-06-06T00:00:00.000Z" },
    };
    const overview = buildPrivacyOverview(fields);
    expect(overview.consentUpToDate).toBe(false);
    expect(overview.acceptedPrivacyVersion).toBe("2020-01-01");
    expect(overview.currentPrivacyVersion).toBe(CURRENT_PRIVACY_VERSION);
  });

  it("re-acceptance is required when parentalConsentAt is missing", () => {
    const fields: Record<string, FirestoreValue> = {
      acceptedTermsVersion: { stringValue: CURRENT_TERMS_VERSION },
      acceptedPrivacyVersion: { stringValue: CURRENT_PRIVACY_VERSION },
    };
    const overview = buildPrivacyOverview(fields);
    expect(overview.consentUpToDate).toBe(false);
    expect(overview.parentalConsentAt).toBe("");
  });
});

describe("data summary", () => {
  it("renders all canonical categories, using null for untracked counts", () => {
    const summary = buildDataSummary({ familyProfile: 1, chores: 5 });
    const byKey = Object.fromEntries(summary.categories.map((c) => [c.key, c.count]));
    expect(byKey.familyProfile).toBe(1);
    expect(byKey.chores).toBe(5);
    expect(byKey.apiTokens).toBeNull();
    expect(summary.categories).toHaveLength(10);
  });
});

describe("legal document loader", () => {
  it("getPrivacyPolicy returns a document with id, version, and sections", () => {
    const doc = getPrivacyPolicy();
    expect(doc.id).toBe("privacy-policy");
    expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(doc.sections)).toBe(true);
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.requiresReacceptance).toBe(true);
  });

  it("getTermsOfService returns a document with id, version, and sections", () => {
    const doc = getTermsOfService();
    expect(doc.id).toBe("terms-of-service");
    expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(doc.sections)).toBe(true);
    expect(doc.sections.length).toBeGreaterThan(0);
  });

  it("getCurrentPrivacyPolicyVersion returns the document version by default", () => {
    const doc = getPrivacyPolicy();
    const version = getCurrentPrivacyPolicyVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    // Without an env override the function falls back to the JSON version.
    expect(version).toBe(doc.version);
  });

  it("getCurrentTermsVersion returns the document version by default", () => {
    const doc = getTermsOfService();
    const version = getCurrentTermsVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    expect(version).toBe(doc.version);
  });

  it("config.ts CURRENT_TERMS_VERSION matches the legal document version", () => {
    // Verifies the single-source-of-truth chain: JSON → loader → config
    expect(CURRENT_TERMS_VERSION).toBe(getCurrentTermsVersion());
  });

  it("config.ts CURRENT_PRIVACY_VERSION matches the legal document version", () => {
    expect(CURRENT_PRIVACY_VERSION).toBe(getCurrentPrivacyPolicyVersion());
  });

  it("privacy policy sections each have a heading string", () => {
    const doc = getPrivacyPolicy();
    for (const section of doc.sections) {
      expect(typeof section.heading).toBe("string");
      expect(section.heading.length).toBeGreaterThan(0);
    }
  });

  it("terms of service sections each have a heading string", () => {
    const doc = getTermsOfService();
    for (const section of doc.sections) {
      expect(typeof section.heading).toBe("string");
      expect(section.heading.length).toBeGreaterThan(0);
    }
  });

  it("privacy policy document version matches CURRENT_PRIVACY_VERSION", () => {
    const doc = getPrivacyPolicy();
    // The version in the JSON file is the canonical default; if CURRENT_PRIVACY_VERSION
    // differs it means an env override is active (acceptable) but the default must match.
    expect(doc.version).toBe("2026-06-06");
    expect(CURRENT_PRIVACY_VERSION).toBe(doc.version);
  });

  it("terms document version matches CURRENT_TERMS_VERSION", () => {
    const doc = getTermsOfService();
    expect(doc.version).toBe("2026-06-06");
    expect(CURRENT_TERMS_VERSION).toBe(doc.version);
  });

  it("returns the bundled legal document when the requested version matches", () => {
    const privacy = getLegalDocumentByVersion("privacy-policy", CURRENT_PRIVACY_VERSION);
    const terms = getLegalDocumentByVersion("terms-of-service", CURRENT_TERMS_VERSION);
    expect(privacy?.id).toBe("privacy-policy");
    expect(terms?.id).toBe("terms-of-service");
  });

  it("returns null when a requested legal version is unavailable", () => {
    expect(getLegalDocumentByVersion("privacy-policy", "1900-01-01")).toBeNull();
    expect(getLegalDocumentByVersion("terms-of-service", "1900-01-01")).toBeNull();
  });
});

describe("export sanitizers", () => {
  describe("sanitizeMemberForExport", () => {
    const baseMember = {
      id: "uid-abc",
      uid: "uid-abc",
      name: "Avery",
      email: "avery@example.com",
      role: "player",
      status: "active",
      coinBalance: 50,
      avatarPhotoUrl: "https://lh3.googleusercontent.com/a/photo.jpg",
      avatarType: "app",
      avatarId: "cat-01",
      lastSignInAt: "2026-06-01T00:00:00.000Z",
      lastActiveAt: "2026-06-05T00:00:00.000Z",
    };

    it("does not include Google OAuth avatar URLs", () => {
      const result = sanitizeMemberForExport(baseMember);
      expect(result).not.toHaveProperty("avatarPhotoUrl");
      const json = JSON.stringify(result);
      expect(json).not.toContain("lh3.googleusercontent.com");
    });

    it("adds hasExternalAvatar flag when an OAuth URL was present", () => {
      const result = sanitizeMemberForExport(baseMember);
      expect(result.hasExternalAvatar).toBe(true);
    });

    it("keeps app-managed avatar fields", () => {
      const result = sanitizeMemberForExport(baseMember);
      expect(result.avatarType).toBe("app");
      expect(result.avatarId).toBe("cat-01");
    });

    it("excludes login timestamps for child (player) members", () => {
      const result = sanitizeMemberForExport({ ...baseMember, role: "player" });
      expect(result).not.toHaveProperty("lastSignInAt");
      expect(result).not.toHaveProperty("lastActiveAt");
    });

    it("includes login timestamps for parent (admin) members", () => {
      const result = sanitizeMemberForExport({ ...baseMember, role: "admin" });
      expect(result.lastSignInAt).toBe("2026-06-01T00:00:00.000Z");
      expect(result.lastActiveAt).toBe("2026-06-05T00:00:00.000Z");
    });

    it("does not include raw Firestore document without passing through sanitizer", () => {
      const raw = {
        ...baseMember,
        googleTasksRefreshToken: "secret",
        firebaseIdToken: "tok",
      };
      const result = sanitizeMemberForExport(raw);
      expect(result).not.toHaveProperty("googleTasksRefreshToken");
      expect(result).not.toHaveProperty("firebaseIdToken");
    });

    it("does not add hasExternalAvatar when no OAuth URL is present", () => {
      const noUrl = { ...baseMember };
      delete (noUrl as Record<string, unknown>).avatarPhotoUrl;
      const result = sanitizeMemberForExport(noUrl);
      expect(result).not.toHaveProperty("hasExternalAvatar");
    });
  });

  describe("sanitizeInviteForExport", () => {
    const rawInvite = {
      id: "invited@example.com",
      email: "invited@example.com",
      status: "invited",
      createdAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-06-01T00:00:00.000Z",
      createdBy: "uid-admin-secret",
      inviterUid: "uid-admin-secret",
      internalNotes: "staff note",
    };

    it("does not expose the createdBy admin UID", () => {
      const result = sanitizeInviteForExport(rawInvite);
      expect(result).not.toHaveProperty("createdBy");
      expect(result).not.toHaveProperty("inviterUid");
      const json = JSON.stringify(result);
      expect(json).not.toContain("uid-admin-secret");
    });

    it("keeps the essential invite fields", () => {
      const result = sanitizeInviteForExport(rawInvite);
      expect(result.email).toBe("invited@example.com");
      expect(result.status).toBe("invited");
      expect(result.createdAt).toBe("2026-05-01T00:00:00.000Z");
      expect(result.expiresAt).toBe("2026-06-01T00:00:00.000Z");
    });

    it("drops internal notes and undeclared fields", () => {
      const result = sanitizeInviteForExport(rawInvite);
      expect(result).not.toHaveProperty("internalNotes");
    });
  });

  describe("sanitizeFamilyForExport", () => {
    it("includes name, createdAt, and consent state", () => {
      const result = sanitizeFamilyForExport({
        id: "fam-1",
        name: "The Smiths",
        createdAt: "2026-01-01T00:00:00.000Z",
        acceptedTermsVersion: "2026-06-06",
        parentalConsentAt: "2026-06-06T00:00:00.000Z",
        parentalConsentByUserId: "uid-admin-secret",
        internalAdminNote: "foo",
      });
      expect(result.name).toBe("The Smiths");
      expect(result.acceptedTermsVersion).toBe("2026-06-06");
      expect(result).not.toHaveProperty("parentalConsentByUserId");
      expect(result).not.toHaveProperty("internalAdminNote");
    });
  });

  describe("sanitizeChoreForExport", () => {
    it("includes approved chore fields and drops internal ones", () => {
      const result = sanitizeChoreForExport({
        id: "chore-1",
        title: "Wash dishes",
        coinValue: 5,
        createdByUid: "uid-admin-secret",
        internalId: "sys-123",
      });
      expect(result.title).toBe("Wash dishes");
      expect(result.coinValue).toBe(5);
      expect(result).not.toHaveProperty("createdByUid");
      expect(result).not.toHaveProperty("internalId");
    });
  });

  describe("sanitizeRewardForExport", () => {
    it("includes approved reward fields", () => {
      const result = sanitizeRewardForExport({
        id: "reward-1",
        title: "Ice cream",
        coinCost: 20,
        createdByUid: "uid-admin-secret",
      });
      expect(result.title).toBe("Ice cream");
      expect(result.coinCost).toBe(20);
      expect(result).not.toHaveProperty("createdByUid");
    });
  });

  describe("sanitizeFeedItemForExport", () => {
    it("includes actor name but not actor UID", () => {
      const result = sanitizeFeedItemForExport({
        id: "feed-1",
        eventType: "chore_completed",
        actorName: "Avery",
        actorUid: "uid-private",
        message: "Avery completed a chore",
        createdAt: "2026-06-06T00:00:00.000Z",
      });
      expect(result.actorName).toBe("Avery");
      expect(result.message).toBe("Avery completed a chore");
      expect(result).not.toHaveProperty("actorUid");
    });
  });

  describe("export manifest", () => {
    it("EXPORT_MANIFEST_NOTES documents all three exclusion categories", () => {
      const notes = EXPORT_MANIFEST_NOTES.join(" ");
      expect(notes.toLowerCase()).toContain("avatar");
      expect(notes.toLowerCase()).toContain("child");
      expect(notes.toLowerCase()).toContain("identifier");
    });
  });
});
