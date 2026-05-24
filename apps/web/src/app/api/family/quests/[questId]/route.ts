import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { getFamilyQuestDefinition, getFamilyQuestSummary } from "@/lib/quests/family-quests";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
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
  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(session.uid, session.email ?? "", idToken);
        if (!familyContext.familyId) {
          return { kind: "no_family" as const };
        }
        const summary = await getFamilyQuestSummary(familyContext.familyId, questId, idToken);
        if (!summary) {
          return { kind: "not_found" as const };
        }
        const quest = await getFamilyQuestDefinition(familyContext.familyId, questId, idToken);
        return { kind: "ok" as const, summary, quest, viewerRole: familyContext.viewerRole };
      },
    );

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_required" }, { status: 400 });
    }
    if (data.kind === "not_found") {
      return NextResponse.json({ error: "family_quest_not_found" }, { status: 404 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 220) : "unknown";
    console.error("[FAMILY_QUEST_GET_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "firestore_forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "family_quest_unavailable" }, { status: 500 });
  }
}
