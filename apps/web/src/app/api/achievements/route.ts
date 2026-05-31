import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { getAchievementViewForUser } from "@/lib/achievements/service";
import { resolveAppLocale } from "@/lib/locale";
import { createFamilySocketAuthToken } from "@/lib/ws/family-auth-token";

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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const listenerMode = request.nextUrl.searchParams.get("mode") === "listener";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const context = await getViewerFamilyContext(session.uid, session.email, idToken);
        if (!context.familyId || !context.viewerMember) {
          return {
            kind: "no_family" as const,
            viewerRole: "player" as const,
            viewerUid: session.uid,
            familyId: "",
            wsAuthToken: "",
            achievements: [],
          };
        }
        const viewerRole = context.viewerRole;
        const base = {
          kind: "ok" as const,
          viewerRole,
          viewerUid: session.uid,
          familyId: context.familyId,
          wsAuthToken: createFamilySocketAuthToken({
            uid: session.uid,
            familyIds: [context.familyId],
          }),
        };
        if (listenerMode) {
          return {
            ...base,
            achievements: [],
          };
        }
        const achievements = await getAchievementViewForUser({
          uid: session.uid,
          idToken,
          viewerRole,
          locale: resolveAppLocale({
            sessionLocale: session.locale,
            memberLocale: context.viewerMember?.locale,
            familyLocale: context.familyLocale,
          }),
        });
        return {
          ...base,
          achievements,
        };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENTS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "achievements_unavailable");
  }
}
