import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import {
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readTimestamp,
} from "@/lib/firestore/rest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/privacy/config";
import { computeOnboardingDecision } from "@/lib/family/onboarding";

export const dynamic = "force-dynamic";

// Count active (non-deleted) child/player members. "Children" for onboarding
// purposes are player-role members; admins (parents) don't count.
async function countActiveChildren(familyId: string, idToken: string): Promise<number> {
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 300);
  return memberDocs.filter(
    (doc) => !readBoolean(doc.fields, "deleted") && readString(doc.fields, "role") === "player",
  ).length;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }

        const viewerRole = await getViewerRole(familyId, session.uid, idToken);

        // Players never need onboarding or re-acceptance.
        if (viewerRole !== "admin") {
          return {
            kind: "ok" as const,
            viewerRole: "player" as const,
            needsOnboarding: false,
            needsReacceptance: false,
            redirectTarget: "dashboard" as const,
            currentTermsVersion: CURRENT_TERMS_VERSION,
            currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
          };
        }

        const familyDoc = await getDocument(`families/${familyId}`, idToken);

        const onboardingCompletedAt = readTimestamp(familyDoc.fields, "onboardingCompletedAt");
        const parentalConsentAt = readTimestamp(familyDoc.fields, "parentalConsentAt");
        const acceptedTermsVersion = readString(familyDoc.fields, "acceptedTermsVersion");
        const acceptedPrivacyVersion = readString(familyDoc.fields, "acceptedPrivacyVersion");
        const deletionRequested = Boolean(readTimestamp(familyDoc.fields, "deletionRequestedAt"));
        const isDeleted = readBoolean(familyDoc.fields, "deleted");

        // Count existing children so an already-set-up family is never sent back
        // through onboarding (the duplicate-child P0). See computeOnboardingDecision.
        const childCount = await countActiveChildren(familyId, idToken);

        const decision = computeOnboardingDecision({
          hasFamily: true,
          viewerRole: "admin",
          childCount,
          onboardingCompletedAt: onboardingCompletedAt || null,
          parentalConsentAt: parentalConsentAt || null,
          acceptedTermsVersion,
          acceptedPrivacyVersion,
          currentTermsVersion: CURRENT_TERMS_VERSION,
          currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
          deletedOrDeletionRequested: deletionRequested || isDeleted,
        });

        // Structured log so support can trace the redirect decision per family.
        console.info(
          "[ONBOARDING_REDIRECT_DECISION]",
          JSON.stringify({
            user_id: session.uid,
            family_id: familyId,
            child_count: childCount,
            tos_acceptance_timestamp: parentalConsentAt || null,
            onboarding_state: {
              onboardingCompletedAt: onboardingCompletedAt || null,
              acceptedTermsVersion: acceptedTermsVersion || null,
              acceptedPrivacyVersion: acceptedPrivacyVersion || null,
            },
            redirect_target: decision.redirectTarget,
            needs_onboarding: decision.needsOnboarding,
            needs_reacceptance: decision.needsReacceptance,
          }),
        );

        return {
          kind: "ok" as const,
          viewerRole: "admin" as const,
          needsOnboarding: decision.needsOnboarding,
          needsReacceptance: decision.needsReacceptance,
          redirectTarget: decision.redirectTarget,
          hasPreviousVersionedConsent: decision.hasPreviousVersionedConsent,
          currentTermsVersion: CURRENT_TERMS_VERSION,
          currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
        };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({
        viewerRole: "admin",
        needsOnboarding: true,
        needsReacceptance: false,
        redirectTarget: "family_setup",
        currentTermsVersion: CURRENT_TERMS_VERSION,
        currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
      });
    }

    const { kind: _kind, ...payload } = data;
    const response = NextResponse.json(payload);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ONBOARDING_STATUS_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "onboarding_status_unavailable");
  }
}
