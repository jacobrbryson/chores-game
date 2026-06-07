import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import { patchDocument, stringField, timestampField } from "@/lib/firestore/rest";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  normalizeDataRegion,
} from "@/lib/privacy/config";
import { appendConsentEventBestEffort } from "@/lib/privacy/consent-events";
import {
  CONSENT_DOCUMENT_TYPES,
  CONSENT_EVENT_TYPES,
  PRIVACY_AUDIT_EVENTS,
} from "@/lib/privacy/types";

type ConsentBody = {
  dataRegion?: unknown;
};

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: ConsentBody = {};
  try {
    body = (await request.json()) as ConsentBody;
  } catch {
    body = {};
  }
  const dataRegion = normalizeDataRegion(body.dataRegion);

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}`,
          {
            acceptedTermsVersion: stringField(CURRENT_TERMS_VERSION),
            acceptedPrivacyVersion: stringField(CURRENT_PRIVACY_VERSION),
            parentalConsentAt: timestampField(now),
            parentalConsentByUserId: stringField(session.uid),
            dataRegion: stringField(dataRegion),
            updatedAt: timestampField(now),
          },
          idToken,
          [
            "acceptedTermsVersion",
            "acceptedPrivacyVersion",
            "parentalConsentAt",
            "parentalConsentByUserId",
            "dataRegion",
            "updatedAt",
          ],
        );

        const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
        const userAgent = request.headers.get("user-agent") ?? "";
        const consentEventBase = {
          familyId,
          userId: session.uid,
          ipAddress,
          userAgent,
        };

        // Append three immutable consent event records — one per document type.
        // These are best-effort and must never abort the consent transaction.
        await Promise.all([
          appendConsentEventBestEffort(
            {
              ...consentEventBase,
              eventType: CONSENT_EVENT_TYPES.termsAccepted,
              documentType: CONSENT_DOCUMENT_TYPES.terms,
              documentVersion: CURRENT_TERMS_VERSION,
            },
            idToken,
          ),
          appendConsentEventBestEffort(
            {
              ...consentEventBase,
              eventType: CONSENT_EVENT_TYPES.privacyAccepted,
              documentType: CONSENT_DOCUMENT_TYPES.privacyPolicy,
              documentVersion: CURRENT_PRIVACY_VERSION,
            },
            idToken,
          ),
          appendConsentEventBestEffort(
            {
              ...consentEventBase,
              eventType: CONSENT_EVENT_TYPES.parentalConsentRecorded,
              documentType: CONSENT_DOCUMENT_TYPES.parentalConsent,
              documentVersion: CURRENT_PRIVACY_VERSION,
            },
            idToken,
          ),
        ]);

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: PRIVACY_AUDIT_EVENTS.consentRecorded,
          source: "privacy",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: viewerRole,
          },
          next: {
            acceptedTermsVersion: CURRENT_TERMS_VERSION,
            acceptedPrivacyVersion: CURRENT_PRIVACY_VERSION,
            dataRegion,
          },
        });

        return {
          kind: "ok" as const,
          consent: {
            acceptedTermsVersion: CURRENT_TERMS_VERSION,
            acceptedPrivacyVersion: CURRENT_PRIVACY_VERSION,
            parentalConsentAt: now,
            parentalConsentByUserId: session.uid,
            dataRegion,
          },
        };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ consent: data.consent });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_PRIVACY_CONSENT_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "record_consent_failed");
  }
}
