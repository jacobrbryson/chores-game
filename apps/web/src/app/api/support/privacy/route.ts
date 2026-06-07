import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminListDocuments, adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readString,
  readTimestamp,
} from "@/lib/firestore/rest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/privacy/config";
import { PRIVACY_AUDIT_EVENTS } from "@/lib/privacy/types";

export const runtime = "nodejs";

function familyIdFromDocumentName(name: string) {
  const match = name.match(/\/families\/([^/]+)/);
  return match?.[1] ?? "";
}

const PRIVACY_EVENT_TYPES = new Set<string>(Object.values(PRIVACY_AUDIT_EVENTS));

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const [familyDocs, auditDocs, consentEventDocs] = await Promise.all([
      adminListDocuments("families", 300),
      adminRunQuery({ from: [{ collectionId: "auditLogs", allDescendants: true }], limit: 500 }),
      adminRunQuery({
        from: [{ collectionId: "consentEvents", allDescendants: true }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 100,
      }),
    ]);

    // Families with a pending deletion request, soonest scheduled first.
    const deletionFamilies = familyDocs
      .map((doc) => ({
        id: documentIdFromName(doc.name),
        name: readString(doc.fields, "name") || "Family",
        deletionRequestedAt: readTimestamp(doc.fields, "deletionRequestedAt"),
        deletionScheduledFor: readTimestamp(doc.fields, "deletionScheduledFor"),
      }))
      .filter((family) => Boolean(family.deletionRequestedAt))
      .sort((a, b) => (Date.parse(a.deletionScheduledFor) || 0) - (Date.parse(b.deletionScheduledFor) || 0));

    // Families missing consent or requiring re-acceptance (versions outdated).
    const consentHealthFamilies = familyDocs
      .map((doc) => ({
        id: documentIdFromName(doc.name),
        name: readString(doc.fields, "name") || "Family",
        acceptedTermsVersion: readString(doc.fields, "acceptedTermsVersion"),
        acceptedPrivacyVersion: readString(doc.fields, "acceptedPrivacyVersion"),
        parentalConsentAt: readTimestamp(doc.fields, "parentalConsentAt"),
      }))
      .filter((family) => {
        const hasMissingConsent = !family.parentalConsentAt;
        const hasOutdatedTerms = family.acceptedTermsVersion !== CURRENT_TERMS_VERSION;
        const hasOutdatedPrivacy = family.acceptedPrivacyVersion !== CURRENT_PRIVACY_VERSION;
        return hasMissingConsent || hasOutdatedTerms || hasOutdatedPrivacy;
      })
      .map((family) => ({
        ...family,
        status: !family.parentalConsentAt ? ("missing" as const) : ("outdated" as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Recent privacy-related audit events across all families. Note: we surface
    // event type, actor, and family scope only — never private child detail.
    const events = auditDocs
      .map((doc) => ({
        id: documentIdFromName(doc.name),
        familyId: familyIdFromDocumentName(doc.name),
        eventType: readString(doc.fields, "eventType"),
        actorEmail: readString(doc.fields, "actorEmail"),
        actorName: readString(doc.fields, "actorName"),
        createdAt: readTimestamp(doc.fields, "createdAt"),
      }))
      .filter((event) => PRIVACY_EVENT_TYPES.has(event.eventType))
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, 100);

    // Recent consent events across all families for operator visibility.
    const recentConsentEvents = consentEventDocs
      .map((doc) => ({
        id: documentIdFromName(doc.name),
        familyId: familyIdFromDocumentName(doc.name),
        userId: readString(doc.fields, "userId"),
        eventType: readString(doc.fields, "eventType"),
        documentType: readString(doc.fields, "documentType"),
        documentVersion: readString(doc.fields, "documentVersion"),
        acceptedAt: readTimestamp(doc.fields, "acceptedAt"),
        createdAt: readTimestamp(doc.fields, "createdAt"),
      }))
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, 100);

    const counts = {
      deletionRequested: deletionFamilies.length,
      exports: events.filter((e) => e.eventType === PRIVACY_AUDIT_EVENTS.dataExportRequested).length,
      consents: events.filter((e) => e.eventType === PRIVACY_AUDIT_EVENTS.consentRecorded).length,
      consentMissing: consentHealthFamilies.filter((f) => f.status === "missing").length,
      consentOutdated: consentHealthFamilies.filter((f) => f.status === "outdated").length,
    };

    return NextResponse.json({
      deletionFamilies,
      consentHealthFamilies,
      events,
      recentConsentEvents,
      counts,
      currentTermsVersion: CURRENT_TERMS_VERSION,
      currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_PRIVACY_ERROR]", reason.slice(0, 200));
    return NextResponse.json(
      { error: "support_privacy_unavailable" },
      { status: 500 },
    );
  }
}
