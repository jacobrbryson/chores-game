import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getQuestProgress } from "@/lib/quests/progress";
import { getQuestDefinitionForViewer } from "@/lib/quests/service";

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
      message: "Authenticated user does not have access to Firestore documents under current rules.",
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ questId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { questId } = await context.params;
  if (!questId) {
    return NextResponse.json({ error: "quest_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const quest = await getQuestDefinitionForViewer({
          questId,
          uid: session.uid,
          email: session.email ?? "",
          idToken,
        });
        if (!quest) {
          return { kind: "not_found" as const };
        }
        const progress = await getQuestProgress(session.uid, quest, idToken);
        return { kind: "ok" as const, progress };
      },
    );

    if (data.kind === "not_found") {
      return NextResponse.json({ error: "quest_not_found" }, { status: 404 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 220) : "unknown";
    console.error("[QUEST_PROGRESS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "quest_progress_unavailable");
  }
}
