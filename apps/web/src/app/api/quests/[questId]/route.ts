import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getDocument, readInteger } from "@/lib/firestore/rest";
import { getQuestProgress, listInventoryByItemId } from "@/lib/quests/progress";
import { toRuntimeNode } from "@/lib/quests/runtime";
import { getQuestDefinitionById, getQuestNodeById } from "@/lib/quests/service";
import type { QuestProgress } from "@/lib/quests/types";

function toChoicesMadeByNodeId(progress: QuestProgress) {
  const map = new Map<string, Set<string>>();
  for (const entry of progress.choicesMade) {
    if (!entry.fromNodeId || !entry.choiceId) {
      continue;
    }
    const existing = map.get(entry.fromNodeId) ?? new Set<string>();
    existing.add(entry.choiceId);
    map.set(entry.fromNodeId, existing);
  }
  return map;
}

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
        const quest = await getQuestDefinitionById(questId);
        if (!quest) {
          return { kind: "not_found" as const };
        }

        const [progress, userDoc, inventoryByItem] = await Promise.all([
          getQuestProgress(session.uid, quest, idToken),
          getDocument(`users/${session.uid}`, idToken),
          listInventoryByItemId(session.uid, idToken),
        ]);
        const walletBalance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
        const currentNode = getQuestNodeById(quest, progress.currentNodeId) ?? getQuestNodeById(quest, quest.startNodeId);
        const inventoryByItemId = new Map<string, number>();
        for (const [itemId, entry] of inventoryByItem) {
          inventoryByItemId.set(itemId, entry.quantity);
        }

        return {
          kind: "ok" as const,
          quest,
          progress,
          walletBalance,
          currentNode: currentNode
            ? toRuntimeNode({
                node: currentNode,
                inventoryByItemId,
                walletBalance,
                choicesMadeByNodeId: toChoicesMadeByNodeId(progress),
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
    console.error("[QUEST_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "quest_unavailable");
  }
}
