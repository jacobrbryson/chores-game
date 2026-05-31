import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { ACHIEVEMENT_BY_ID } from "@/lib/achievements/catalog";
import { findGameItemById } from "@/lib/items/catalog";
import { createDefaultQuestProgress, listQuestProgress } from "@/lib/quests/progress";
import { getQuestActionLabel } from "@/lib/quests/runtime";
import { listQuestDefinitionsForViewer } from "@/lib/quests/service";
import type { QuestStatus } from "@/lib/quests/types";

const COMING_SOON_QUEST_IDS = new Set([
  "template-quest-002",
  "template-quest-003",
  "template-quest-004",
  "template-quest-005",
  "template-quest-006",
]);

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
          listQuestDefinitionsForViewer({
            uid: session.uid,
            email: session.email ?? "",
            idToken,
            locale: session.locale,
          }),
          listQuestProgress(session.uid, idToken),
        ]);
        const sortedQuests = [...quests].sort((left, right) => left.id.localeCompare(right.id));
        const progressByQuestId = new Map(progressRows.map((row) => [row.questId, row]));
        const firstQuest = sortedQuests[0] ?? null;
        const firstQuestProgress = firstQuest
          ? (progressByQuestId.get(firstQuest.id) ?? createDefaultQuestProgress(session.uid, firstQuest))
          : null;
        const hasUnlockedQuestPack = Boolean(
          firstQuestProgress && firstQuestProgress.status !== "not_started",
        );

        const visibleQuests = hasUnlockedQuestPack || !firstQuest
          ? sortedQuests
          : sortedQuests.filter((quest) => quest.id === firstQuest.id);

        const entries = visibleQuests.map((quest) => {
          const progress = progressByQuestId.get(quest.id) ?? createDefaultQuestProgress(session.uid, quest);
          const validEndingIds = new Set(
            quest.nodes.filter((node) => node.type === "ending").map((node) => node.ending.endingId),
          );
          const normalizedEndingsDiscovered = Array.from(
            new Set(progress.endingsReached.filter((endingId) => validEndingIds.has(endingId))),
          ).length;
          const normalizedTotalEndings = Math.max(1, quest.meta.totalEndings);
          const clampedEndingsDiscovered = Math.min(normalizedEndingsDiscovered, normalizedTotalEndings);
          const normalizedCompletionStatus: QuestStatus =
            clampedEndingsDiscovered > 0 ? "completed" : progress.status;
          const rewardItems = new Map<string, { id: string; label: string; image?: string }>();
          const rewardAchievements = new Map<string, { id: string; label: string }>();
          const allRewardSets = [
            quest.globalRewards?.firstCompletion,
            quest.globalRewards?.allEndingsDiscovered,
            ...quest.nodes.filter((node) => node.type === "ending").map((node) => node.ending.rewards),
          ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

          for (const rewardSet of allRewardSets) {
            for (const itemId of rewardSet.items ?? []) {
              const item = findGameItemById(itemId);
              if (!item) {
                continue;
              }
              if (!rewardItems.has(item.id)) {
                const itemLabel = item.category === "character" ? `New Avatar: ${item.name}` : item.name;
                rewardItems.set(item.id, {
                  id: item.id,
                  label: itemLabel,
                  image: item.image,
                });
              }
            }
            for (const achievementId of rewardSet.achievements ?? []) {
              const achievement = ACHIEVEMENT_BY_ID.get(achievementId);
              if (!achievement) {
                continue;
              }
              if (!rewardAchievements.has(achievement.id)) {
                rewardAchievements.set(achievement.id, {
                  id: achievement.id,
                  label: achievement.title,
                });
              }
            }
          }

          const prizeHighlights: Array<{ id: string; label: string; image?: string }> = [
            ...Array.from(rewardItems.values()),
            ...Array.from(rewardAchievements.values()),
          ];
          if (quest.id === "template-quest-001") {
            prizeHighlights.push({
              id: "quest-unlock-pack-5",
              label: "Unlocks 5 more quests",
            });
          }
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
            completionStatus: normalizedCompletionStatus,
            endingsDiscovered: clampedEndingsDiscovered,
            totalEndings: normalizedTotalEndings,
            bestEndingId: progress.bestEndingId,
            actionLabel: COMING_SOON_QUEST_IDS.has(quest.id) ? "Start" : getQuestActionLabel(progress),
            prizeHighlights,
            progress,
            locked: COMING_SOON_QUEST_IDS.has(quest.id),
          };
        });
        return {
          quests: entries,
          meta: {
            hasUnlockedQuestPack,
            totalAvailable: sortedQuests.length,
            totalVisible: entries.length,
          },
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
