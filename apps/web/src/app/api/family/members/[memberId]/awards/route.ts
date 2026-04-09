import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { loadFamilyMemberProfileData } from "@/lib/family/member-profiles";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) =>
        loadFamilyMemberProfileData({
          viewerUid: session.uid,
          viewerEmail: session.email,
          memberIdentifier: memberId,
          idToken,
        }),
      );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const response = NextResponse.json({
      familyId: data.profile.familyId,
      familyName: data.profile.familyName,
      viewerRole: data.profile.viewerRole,
      member: data.profile.member,
      claimedAwards: data.profile.claimedAwards,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_MEMBER_AWARDS_GET_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "member_awards_unavailable" }, { status: 500 });
  }
}
