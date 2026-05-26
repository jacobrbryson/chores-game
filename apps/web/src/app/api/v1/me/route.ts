import { NextRequest, NextResponse } from "next/server";
import { fail, ok } from "@/app/api/v1/_lib/response";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getDocument,
  readInteger,
  readString,
  readStringArray,
} from "@/lib/firestore/rest";
import { getPublicApiMe } from "@/lib/public-api/data";
import { withPublicApi } from "@/lib/public-api/middleware";

type MobileMeSummary = {
  balance: number;
  avatarUrl: string;
};

function absoluteLocalAvatarUrl(request: NextRequest, avatarId: string) {
  return new URL(`/avatars/default/${encodeURIComponent(avatarId)}`, request.url).toString();
}

async function getMobileMeSummary(request: NextRequest, uid: string, memberId: string, fallbackPicture: string, idToken: string): Promise<MobileMeSummary> {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const balance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
  const googlePhotoUrl = readString(userDoc.fields, "photoUrl");
  const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  let avatarId = "";
  let avatarPhotoUrl = "";

  if (familyId) {
    for (const candidateMemberId of [memberId, uid].filter(Boolean)) {
      try {
        const memberDoc = await getDocument(`families/${familyId}/members/${candidateMemberId}`, idToken);
        avatarId = readString(memberDoc.fields, "avatarId");
        avatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
        break;
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
    avatarUrl: avatarId
      ? absoluteLocalAvatarUrl(request, avatarId)
      : avatarPhotoUrl || googlePhotoUrl || fallbackPicture,
  };
}

export async function GET(request: NextRequest) {
  if (!request.headers.get("authorization")) {
    const session = getSessionFromRequest(request);
    if (!session?.uid) {
      return fail("unauthorized", "Sign in required", 401);
    }

    const fallbackSummary = {
      balance: 0,
      avatarUrl: session.picture || "",
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

    const response = ok({
      uid: session.uid,
      memberId: session.memberId,
      name: session.name,
      email: session.email,
      role: session.role,
      picture: session.picture || "",
      avatarUrl: summary.avatarUrl,
      balance: summary.balance,
    });
    if (shouldSetSessionCookie) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  }

  return withPublicApi(request, ["read:profile"], async ({ token }) => {
    return NextResponse.json(await getPublicApiMe(token));
  });
}
