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
import { getDocument, readBoolean, readString, readTimestamp } from "@/lib/firestore/rest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/privacy/config";

export const dynamic = "force-dynamic";

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

        if (deletionRequested || isDeleted) {
          return {
            kind: "ok" as const,
            viewerRole: "admin" as const,
            needsOnboarding: false,
            needsReacceptance: false,
            currentTermsVersion: CURRENT_TERMS_VERSION,
            currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
          };
        }

        // A family is "onboarding complete" if they have either:
        //   1. The new onboardingCompletedAt timestamp (set by the wizard), OR
        //   2. Existing parentalConsentAt (existing users who pre-date the wizard).
        // This preserves "Existing users should not repeat onboarding."
        const hasCompletedOnboarding = Boolean(onboardingCompletedAt || parentalConsentAt);
        const needsOnboarding = !hasCompletedOnboarding;

        const consentUpToDate =
          Boolean(parentalConsentAt) &&
          acceptedTermsVersion === CURRENT_TERMS_VERSION &&
          acceptedPrivacyVersion === CURRENT_PRIVACY_VERSION;

        // Re-acceptance is only needed when onboarding is already done but consent is stale.
        const needsReacceptance = !needsOnboarding && !consentUpToDate;

        // True only when the family has previously accepted a *versioned* policy.
        // False for families whose consent pre-dates version tracking
        // (parentalConsentAt set but acceptedTermsVersion empty). The UI uses
        // this to show "Accept" vs "Re-accept" copy.
        const hasPreviousVersionedConsent = Boolean(acceptedTermsVersion);

        return {
          kind: "ok" as const,
          viewerRole: "admin" as const,
          needsOnboarding,
          needsReacceptance,
          hasPreviousVersionedConsent,
          currentTermsVersion: CURRENT_TERMS_VERSION,
          currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
        };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({
        viewerRole: "admin",
        needsOnboarding: false,
        needsReacceptance: false,
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
