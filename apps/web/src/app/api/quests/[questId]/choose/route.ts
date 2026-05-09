import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getPrimaryFamilyIdWithFallback } from "@/lib/family/member-access";
import { getDocument, readInteger } from "@/lib/firestore/rest";
import { findGameItemById } from "@/lib/items/catalog";
import {
  commitQuestChoiceWithOptionalPurchase,
  getQuestProgressWithMeta,
  listInventoryByItemId,
  resolveBestEndingId,
} from "@/lib/quests/progress";
import { getEndingNodeMap, toRuntimeNode } from "@/lib/quests/runtime";
import { getQuestDefinitionById, getQuestNodeById } from "@/lib/quests/service";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import type { QuestProgress } from "@/lib/quests/types";

type ChooseBody = {
  choiceId?: unknown;
  purchaseIfMissing?: unknown;
};

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
  if (
    reason.includes("FIRESTORE_HTTP_409") ||
    reason.includes("FIRESTORE_HTTP_412") ||
    reason.includes("ABORTED")
  ) {
    return NextResponse.json({ error: "quest_conflict_retry" }, { status: 409 });
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

  let body: ChooseBody;
  try {
    body = (await request.json()) as ChooseBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const choiceId = typeof body.choiceId === "string" ? body.choiceId.trim() : "";
  const purchaseIfMissing = body.purchaseIfMissing === true;
  if (!choiceId) {
    return NextResponse.json({ error: "choice_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const quest = await getQuestDefinitionById(questId);
        if (!quest) {
          return { kind: "quest_not_found" as const };
        }

        const [progressMeta, userDoc, inventoryByItem] = await Promise.all([
          getQuestProgressWithMeta(session.uid, quest, idToken),
          getDocument(`users/${session.uid}`, idToken),
          listInventoryByItemId(session.uid, idToken),
        ]);
        const currentWalletBalance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
        const progress = progressMeta.progress;
        const activeNode = getQuestNodeById(quest, progress.currentNodeId) ?? getQuestNodeById(quest, quest.startNodeId);
        if (!activeNode) {
          return { kind: "quest_state_invalid" as const, error: "current_node_missing" };
        }
        if (activeNode.type !== "story") {
          return { kind: "quest_state_invalid" as const, error: "choice_not_allowed_on_ending" };
        }
        const choice = activeNode.choices.find((entry) => entry.id === choiceId);
        if (!choice) {
          return { kind: "invalid_choice" as const };
        }

        const requiredItemId = choice.requiredItemId?.trim() ?? "";
        const requiredItem = requiredItemId ? findGameItemById(requiredItemId) : null;
        const isFreeStoryChoice = !requiredItemId;
        if (requiredItemId && !requiredItem) {
          return { kind: "required_item_missing" as const };
        }
        const currentItemInventory = requiredItem ? inventoryByItem.get(requiredItem.id) : null;
        const ownedQuantity = currentItemInventory?.quantity ?? 0;
        const isOwned = isFreeStoryChoice ? true : ownedQuantity > 0;
        const canPurchaseWhenMissing =
          (requiredItem?.purchasable ?? false) &&
          choice.purchaseBehavior.allowPurchaseIfMissing &&
          !isFreeStoryChoice;
        const canAffordPurchase = requiredItem ? currentWalletBalance >= requiredItem.price : true;
        const shouldPurchase = !isOwned && purchaseIfMissing && canPurchaseWhenMissing;
        if (!isOwned && !shouldPurchase) {
          if (!purchaseIfMissing) {
            return { kind: "required_item_missing" as const };
          }
          if (!canPurchaseWhenMissing) {
            return { kind: "required_item_not_purchasable" as const };
          }
          return { kind: "insufficient_funds" as const, requiredCoins: requiredItem?.price ?? 0 };
        }
        if (shouldPurchase && !canAffordPurchase) {
          return { kind: "insufficient_funds" as const, requiredCoins: requiredItem?.price ?? 0 };
        }

        const nextNode = getQuestNodeById(quest, choice.nextNodeId);
        if (!nextNode) {
          return { kind: "next_node_missing" as const };
        }

        const nowIso = new Date().toISOString();
        const purchasedBeforeUse = shouldPurchase;
        const purchasePrice = shouldPurchase ? requiredItem?.price ?? 0 : 0;
        const resultingRequiredItemQuantity =
          isFreeStoryChoice ? 0 : ownedQuantity + (shouldPurchase ? 1 : 0) - (choice.consumeItem ? 1 : 0);
        if (resultingRequiredItemQuantity < 0) {
          return { kind: "required_item_missing" as const };
        }

        const endingNodesByEndingId = getEndingNodeMap(quest);
        let endingsReached = [...progress.endingsReached];
        let endingRewardIdsGranted = [...progress.endingRewardIdsGranted];
        let bestEndingId = progress.bestEndingId;
        let status: "not_started" | "in_progress" | "completed" = "in_progress";
        let completedAt = progress.completedAt;
        let rewardCoins = 0;
        const rewardItemIds: string[] = [];
        const earnedAchievements: string[] = [];
        let firstCompletionRewardGrantedAt = progress.firstCompletionRewardGrantedAt;
        let allEndingsRewardGrantedAt = progress.allEndingsRewardGrantedAt;
        let reachedEndingId = "";
        let reachedEndingIsNew = false;

        if (nextNode.type === "ending") {
          reachedEndingId = nextNode.ending.endingId;
          reachedEndingIsNew = !endingsReached.includes(reachedEndingId);
          if (reachedEndingIsNew) {
            endingsReached = [...endingsReached, reachedEndingId];
          }
          bestEndingId = resolveBestEndingId(bestEndingId, reachedEndingId, endingNodesByEndingId);
          status = "completed";
          completedAt = nowIso;

          if (!endingRewardIdsGranted.includes(reachedEndingId)) {
            endingRewardIdsGranted = [...endingRewardIdsGranted, reachedEndingId];
            rewardItemIds.push(...nextNode.ending.rewards.items);
            earnedAchievements.push(...nextNode.ending.rewards.achievements);
          }
          if (!firstCompletionRewardGrantedAt && quest.globalRewards?.firstCompletion) {
            firstCompletionRewardGrantedAt = nowIso;
            rewardItemIds.push(...quest.globalRewards.firstCompletion.items);
            earnedAchievements.push(...quest.globalRewards.firstCompletion.achievements);
          }
          if (
            !allEndingsRewardGrantedAt &&
            endingsReached.length >= quest.meta.totalEndings &&
            quest.globalRewards?.allEndingsDiscovered
          ) {
            allEndingsRewardGrantedAt = nowIso;
            rewardItemIds.push(...quest.globalRewards.allEndingsDiscovered.items);
            earnedAchievements.push(...quest.globalRewards.allEndingsDiscovered.achievements);
          }
        }

        const nextWalletBalance = currentWalletBalance - purchasePrice + rewardCoins;
        if (nextWalletBalance < 0) {
          return { kind: "insufficient_funds" as const, requiredCoins: requiredItem?.price ?? 0 };
        }

        const nextProgress = {
          ...progress,
          currentNodeId: nextNode.id,
          status,
          timesPlayed: Math.max(1, progress.timesPlayed),
          choicesMade: [
            ...progress.choicesMade,
            {
              choiceId: choice.id,
              fromNodeId: activeNode.id,
              toNodeId: nextNode.id,
              usedItemId: requiredItem?.id ?? "",
              purchasedBeforeUse,
              consumedItem: choice.consumeItem,
              createdAt: nowIso,
            },
          ],
          endingsReached,
          bestEndingId,
          completedAt: status === "completed" ? completedAt : "",
          lastPlayedAt: nowIso,
          updatedAt: nowIso,
          firstCompletionRewardGrantedAt,
          allEndingsRewardGrantedAt,
          endingRewardIdsGranted,
        };

        await commitQuestChoiceWithOptionalPurchase({
          uid: session.uid,
          idToken,
          nowIso,
          questId: quest.id,
          nextProgress,
          previousProgressUpdateTime: progressMeta.updateTime || undefined,
          requiredItemId: requiredItem?.id,
          purchasePrice,
          rewardCoins,
          rewardItemIds,
          shouldPurchase,
          consumeItem: choice.consumeItem,
          nextWalletBalance,
          currentUserUpdateTime: userDoc.updateTime || "",
          inventoryByItemId: inventoryByItem,
          resultingInventoryQuantity: resultingRequiredItemQuantity,
        });

        const nextInventoryByItemId = new Map<string, number>();
        for (const [itemId, entry] of inventoryByItem) {
          nextInventoryByItemId.set(itemId, entry.quantity);
        }
        if (requiredItem) {
          nextInventoryByItemId.set(requiredItem.id, resultingRequiredItemQuantity);
        }
        for (const rewardItemId of rewardItemIds) {
          nextInventoryByItemId.set(rewardItemId, (nextInventoryByItemId.get(rewardItemId) ?? 0) + 1);
        }

        const maybeFamilyId = await getPrimaryFamilyIdWithFallback(session.uid, session.email, idToken);
        if (maybeFamilyId && (rewardCoins > 0 || rewardItemIds.length > 0 || earnedAchievements.length > 0)) {
          await publishFamilyActivity({
            type: "quest_rewarded",
            familyId: maybeFamilyId,
            occurredAt: nowIso,
          });
          await emitFamilyActivity({
            familyId: maybeFamilyId,
            idToken,
            kind: "chore_completed",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName: session.name || session.email || "Family member",
            title: "Quest rewards earned",
                message: `${session.name || "A player"} earned quest rewards in ${quest.title}.`,
            relatedIds: [session.uid, session.email],
          });
        }

        return {
          kind: "ok" as const,
          progress: nextProgress,
          walletBalance: nextWalletBalance,
          currentNode: toRuntimeNode({
            node: nextNode,
            inventoryByItemId: nextInventoryByItemId,
            walletBalance: nextWalletBalance,
            choicesMadeByNodeId: toChoicesMadeByNodeId(nextProgress),
          }),
          transaction: {
            purchasedItemId: shouldPurchase ? requiredItem?.id ?? "" : "",
            spentCoins: purchasePrice,
            rewardCoins,
            rewardItemIds,
            earnedAchievements,
          },
          ending: nextNode.type === "ending"
            ? {
                endingId: nextNode.ending.endingId,
                isNewEnding: reachedEndingIsNew,
                endingsDiscovered: nextProgress.endingsReached.length,
                totalEndings: quest.meta.totalEndings,
                replayHint: nextNode.ending.replayHint || "There are other paths to explore.",
                rewardSummary: nextNode.ending.rewardSummary,
                rewards: nextNode.ending.rewards,
              }
            : null,
        };
      },
    );

    if (data.kind === "quest_not_found") {
      return NextResponse.json({ error: "quest_not_found" }, { status: 404 });
    }
    if (data.kind === "invalid_choice") {
      return NextResponse.json({ error: "invalid_choice" }, { status: 400 });
    }
    if (data.kind === "required_item_missing") {
      return NextResponse.json({ error: "required_item_missing" }, { status: 409 });
    }
    if (data.kind === "required_item_not_purchasable") {
      return NextResponse.json({ error: "required_item_not_purchasable" }, { status: 409 });
    }
    if (data.kind === "insufficient_funds") {
      return NextResponse.json(
        { error: "insufficient_funds", requiredCoins: data.requiredCoins ?? 0 },
        { status: 409 },
      );
    }
    if (data.kind === "next_node_missing" || data.kind === "quest_state_invalid") {
      return NextResponse.json({ error: data.error ?? "quest_state_invalid" }, { status: 409 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 220) : "unknown";
    console.error("[QUEST_CHOOSE_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "quest_choice_failed");
  }
}
