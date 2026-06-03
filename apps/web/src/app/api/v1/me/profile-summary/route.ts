import { NextRequest } from "next/server";
import { fail, ok } from "@/app/api/v1/_lib/response";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { loadFamilyMemberProfileData } from "@/lib/family/member-profiles";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return fail("unauthorized", "Sign in required", 401);
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return fail("reauth_required", "Please sign out and sign in again to refresh your session.", 401);
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) =>
        loadFamilyMemberProfileData({
          viewerUid: session.uid,
          viewerEmail: session.email,
          memberIdentifier: session.memberId || session.uid,
          idToken,
        }),
    );

    if (data.kind === "family_not_found") {
      return fail("family_not_found", "Family not found", 404);
    }
    if (data.kind === "member_not_found") {
      return fail("member_not_found", "Member not found", 404);
    }
    if (data.kind === "forbidden") {
      return fail("forbidden", "Profile unavailable", 403);
    }

    const response = ok(data.profile);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[MOBILE_PROFILE_SUMMARY_GET_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return fail("reauth_required", "Please sign out and sign in again to refresh your session.", 401);
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return fail("firestore_forbidden", "Profile unavailable", 403);
    }
    return fail("profile_summary_unavailable", "Profile summary unavailable", 500);
  }
}
