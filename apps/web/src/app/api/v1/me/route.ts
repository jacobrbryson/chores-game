import { NextRequest, NextResponse } from "next/server";
import type { AppLocale } from "@packages/locales";
import { fail, ok } from "@/app/api/v1/_lib/response";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getAuthenticatedSessionIdentity, isKioskActive, isSessionSwitched } from "@/lib/auth/session";
import {
  getDocument,
  readInteger,
  readString,
  readStringArray,
} from "@/lib/firestore/rest";
import { DEFAULT_LOCALE, resolveAppLocale } from "@/lib/locale";
import { mobileWebCorsPreflight, withMobileWebCors } from "@/lib/mobile-web-cors";
import { getPublicApiMe } from "@/lib/public-api/data";
import { withPublicApi } from "@/lib/public-api/middleware";

type MobileMeSummary = {
  balance: number;
  avatarUrl: string;
  locale: AppLocale;
};

function absoluteLocalAvatarUrl(request: NextRequest, avatarId: string) {
  return new URL(`/avatars/default/${encodeURIComponent(avatarId)}`, request.url).toString();
}

async function getMobileMeSummary(request: NextRequest, uid: string, memberId: string, fallbackPicture: string, idToken: string): Promise<MobileMeSummary> {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const balance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
  const googlePhotoUrl = readString(userDoc.fields, "photoUrl");
  const userLocale = readString(userDoc.fields, "locale");
  const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  let avatarId = "";
  let avatarPhotoUrl = "";
  let familyLocale = "";
  let memberLocale = "";

  if (familyId) {
    try {
      const familyDoc = await getDocument(`families/${familyId}`, idToken);
      familyLocale = readString(familyDoc.fields, "defaultLocale");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
    for (const candidateMemberId of [memberId, uid].filter(Boolean)) {
      try {
        const memberDoc = await getDocument(`families/${familyId}/members/${candidateMemberId}`, idToken);
        const candidateAvatarId = readString(memberDoc.fields, "avatarId");
        const candidateAvatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
        const candidateLocale = readString(memberDoc.fields, "locale");
        if (candidateAvatarId || candidateAvatarPhotoUrl) {
          avatarId = candidateAvatarId;
          avatarPhotoUrl = candidateAvatarPhotoUrl;
        }
        if (candidateLocale && !memberLocale) {
          memberLocale = candidateLocale;
        }
        if (candidateAvatarId || candidateAvatarPhotoUrl) {
          break;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (!reason.includes("FIRESTORE_HTTP_404")) {
          throw error;
        }
      }
    }
  }

  return {
    balance,
    locale: resolveAppLocale({
      userLocale,
      memberLocale,
      familyLocale,
    }),
    avatarUrl: avatarId
      ? absoluteLocalAvatarUrl(request, avatarId)
      : avatarPhotoUrl || googlePhotoUrl || fallbackPicture,
  };
}

export async function GET(request: NextRequest) {
  if (!request.headers.get("authorization")) {
    const session = getSessionFromRequest(request);
    if (!session?.uid) {
      return withMobileWebCors(fail("unauthorized", "Sign in required", 401), request);
    }

    const fallbackSummary = {
      balance: 0,
      avatarUrl: session.picture || "",
      locale: session.locale || DEFAULT_LOCALE,
    };
    let summary = fallbackSummary;
    let refreshedSession = session;
    let shouldSetSessionCookie = false;

    if (session.firebaseIdToken || session.firebaseRefreshToken) {
      try {
        const result = await runWithRefreshedFirebaseToken(session, (idToken) =>
          getMobileMeSummary(
            request,
            session.uid,
            session.memberId || session.uid,
            session.picture || "",
            idToken,
          ),
        );
        summary = result.data;
        refreshedSession = result.session;
        shouldSetSessionCookie = result.refreshed;
      } catch {
        summary = fallbackSummary;
      }
    }

    const switched = isSessionSwitched(session);
    const response = ok({
      uid: session.uid,
      memberId: session.memberId,
      name: session.name,
      email: session.email,
      role: session.role,
      picture: session.picture || "",
      avatarUrl: summary.avatarUrl,
      balance: summary.balance,
      locale: session.locale || summary.locale,
      resolvedLocale: summary.locale,
      // Account-switch ("Switch To...") and Kiosk Mode state, mirroring the web
      // profile menu so the mobile menu can offer "Return to Parent" / kiosk
      // controls while acting as a child.
      isSwitched: switched,
      kioskActive: isKioskActive(session),
      authenticatedName:
        switched || isKioskActive(session) ? getAuthenticatedSessionIdentity(session).name : "",
    });
    if (shouldSetSessionCookie || refreshedSession.locale !== summary.locale) {
      setSessionUserCookie(response, { ...refreshedSession, locale: summary.locale });
    }
    return withMobileWebCors(response, request);
  }

  return withPublicApi(request, ["read:profile"], async ({ token }) => {
    return NextResponse.json(await getPublicApiMe(token));
  });
}

export function OPTIONS(request: NextRequest) {
  return mobileWebCorsPreflight(request);
}
