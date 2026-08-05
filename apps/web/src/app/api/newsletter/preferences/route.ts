import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getNewsletterPreferences,
  updateNewsletterPreferences,
} from "@/lib/newsletters/preferences";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
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
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => getNewsletterPreferences(session.uid, idToken),
    );
    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[NEWSLETTER_PREFERENCES_GET_ERROR]", reason);
    return NextResponse.json({ error: "newsletter_preferences_unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  type PreferencesPatchBody = {
    weeklyFamilyHighlightsEmail?: unknown;
    familyFriendInviteEmail?: unknown;
  };
  let body: PreferencesPatchBody;
  try {
    body = (await request.json()) as PreferencesPatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (
    "weeklyFamilyHighlightsEmail" in body &&
    typeof body.weeklyFamilyHighlightsEmail !== "boolean"
  ) {
    return NextResponse.json({ error: "invalid_weekly_family_highlights_email" }, { status: 400 });
  }
  if ("familyFriendInviteEmail" in body && typeof body.familyFriendInviteEmail !== "boolean") {
    return NextResponse.json({ error: "invalid_family_friend_invite_email" }, { status: 400 });
  }
  if (
    typeof body.weeklyFamilyHighlightsEmail !== "boolean" &&
    typeof body.familyFriendInviteEmail !== "boolean"
  ) {
    return NextResponse.json({ error: "no_preferences_provided" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) =>
        updateNewsletterPreferences({
          uid: session.uid,
          idToken,
          weeklyFamilyHighlightsEmail: body.weeklyFamilyHighlightsEmail as boolean | undefined,
          familyFriendInviteEmail: body.familyFriendInviteEmail as boolean | undefined,
        }),
    );
    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[NEWSLETTER_PREFERENCES_PATCH_ERROR]", reason);
    return NextResponse.json({ error: "newsletter_preferences_update_failed" }, { status: 500 });
  }
}
