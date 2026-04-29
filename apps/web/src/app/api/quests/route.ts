import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { createDefaultQuestProgress, listQuestProgress } from "@/lib/quests/progress";
import { getQuestActionLabel } from "@/lib/quests/runtime";
import { listQuestDefinitions } from "@/lib/quests/service";

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
      async (idToken) => {
        const [quests, progressRows] = await Promise.all([
          listQuestDefinitions(),
          listQuestProgress(session.uid, idToken),
        ]);
        const progressByQuestId = new Map(progressRows.map((row) => [row.questId, row]));
        const entries = quests.map((quest) => {
          const progress = progressByQuestId.get(quest.id) ?? createDefaultQuestProgress(session.uid, quest);
          return {
            questId: quest.id,
            slug: quest.slug,
            title: quest.title,
            subtitle: quest.subtitle,
            author: quest.author,
            coverImage: quest.coverImage || "",
            summary: quest.summary,
            ageRange: quest.ageRange,
            estimatedMinutes: quest.estimatedMinutes,
            difficulty: quest.difficulty,
            completionStatus: progress.status,
            endingsDiscovered: progress.endingsReached.length,
            totalEndings: quest.meta.totalEndings,
            bestEndingId: progress.bestEndingId,
            actionLabel: getQuestActionLabel(progress),
            progress,
          };
        });
        return {
          quests: entries,
        };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 220) : "unknown";
    console.error("[QUESTS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "quests_unavailable");
  }
}
