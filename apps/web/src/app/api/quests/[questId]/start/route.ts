import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getDocument, readInteger } from "@/lib/firestore/rest";
import { getQuestProgress, listInventoryByItemId, saveQuestProgress } from "@/lib/quests/progress";
import { toRuntimeNode } from "@/lib/quests/runtime";
import { getQuestDefinitionById, getQuestNodeById } from "@/lib/quests/service";

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

export async function POST(
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
        const quest = await getQuestDefinitionById(questId);
        if (!quest) {
          return { kind: "not_found" as const };
        }
        const nowIso = new Date().toISOString();
        const progress = await getQuestProgress(session.uid, quest, idToken);
        const nextProgress = {
          ...progress,
          currentNodeId: quest.startNodeId,
          status: "in_progress" as const,
          timesPlayed: progress.timesPlayed > 0 ? progress.timesPlayed : 1,
          lastPlayedAt: nowIso,
          updatedAt: nowIso,
        };
        await saveQuestProgress(session.uid, quest.id, nextProgress, idToken);

        const [userDoc, inventoryByItem] = await Promise.all([
          getDocument(`users/${session.uid}`, idToken),
          listInventoryByItemId(session.uid, idToken),
        ]);
        const walletBalance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
        const inventoryByItemId = new Map<string, number>();
        for (const [itemId, entry] of inventoryByItem) {
          inventoryByItemId.set(itemId, entry.quantity);
        }
        const startNode = getQuestNodeById(quest, quest.startNodeId);
        return {
          kind: "ok" as const,
          progress: nextProgress,
          walletBalance,
          currentNode: startNode
            ? toRuntimeNode({
                node: startNode,
                inventoryByItemId,
                walletBalance,
              })
            : null,
        };
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
    console.error("[QUEST_START_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "quest_start_failed");
  }
}
