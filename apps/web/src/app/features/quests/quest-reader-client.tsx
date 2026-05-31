"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";

type QuestChoiceRuntime = {
  id: string;
  label: string;
  description: string;
  requiredItemId: string;
  requiredItemName: string;
  requiredItemImage: string;
  consumeItem: boolean;
  allowPurchaseIfMissing: boolean;
  purchaseAndUseImmediately: boolean;
  purchasable: boolean;
  canAfford: boolean;
  price: number;
  ownedQuantity: number;
  owned: boolean;
  madeBefore: boolean;
  disabled: boolean;
  actionText: string;
  unavailableText: string;
};

type QuestRuntimeNode =
  | {
      type: "story";
      id: string;
      title: string;
      image?: string;
      audio?: string;
      text: string;
      choices: QuestChoiceRuntime[];
    }
  | {
      type: "ending";
      id: string;
      title: string;
      image?: string;
      audio?: string;
      text: string;
      ending: {
        endingId: string;
        replayHint?: string;
        rewardSummary: string;
        rewards: {
          coins: number;
          items: string[];
          achievements: string[];
        };
      };
    };

type QuestProgress = {
  status: "not_started" | "in_progress" | "completed";
  endingsReached: string[];
};

type QuestStateResponse = {
  kind: "ok";
  quest: {
    id: string;
    title: string;
    subtitle: string;
    meta: { totalEndings: number };
  };
  progress: QuestProgress;
  walletBalance: number;
  currentNode: QuestRuntimeNode | null;
};

type ChooseResponse = {
  kind: "ok";
  progress: QuestProgress;
  walletBalance: number;
  currentNode: QuestRuntimeNode;
  transaction: {
    spentCoins: number;
    rewardCoins: number;
    rewardItemIds: string[];
    earnedAchievements: string[];
  };
  ending: null | {
    endingId: string;
    isNewEnding: boolean;
    endingsDiscovered: number;
    totalEndings: number;
    replayHint: string;
    rewardSummary: string;
    rewards: {
      coins: number;
      items: string[];
      achievements: string[];
    };
  };
};

type QuestReaderClientProps = {
  questId: string;
};

const QUEST_AUDIO_PAUSED_STORAGE_KEY = "quests_audio_paused";

export function QuestReaderClient({ questId }: QuestReaderClientProps) {
  const { t } = useLocale();
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [pendingChoiceId, setPendingChoiceId] = useState("");
  const [error, setError] = useState("");
  const [questTitle, setQuestTitle] = useState("");
  const [progress, setProgress] = useState<QuestProgress | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [currentNode, setCurrentNode] = useState<QuestRuntimeNode | null>(null);
  const [totalEndings, setTotalEndings] = useState(0);
  const [lastEndingState, setLastEndingState] = useState<ChooseResponse["ending"] | null>(null);
  const [lastTransaction, setLastTransaction] = useState<ChooseResponse["transaction"] | null>(null);
  const [audioPausedByUser, setAudioPausedByUser] = useState(false);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const suppressNextPausePersistRef = useRef(false);

  useEffect(() => {
    try {
      setAudioPausedByUser(window.localStorage.getItem(QUEST_AUDIO_PAUSED_STORAGE_KEY) === "1");
    } catch {
      setAudioPausedByUser(false);
    }
  }, []);

  const loadQuestState = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/quests/${encodeURIComponent(questId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `QUEST_READER_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as QuestStateResponse;
      setQuestTitle(payload.quest.title);
      setProgress(payload.progress);
      setWalletBalance(payload.walletBalance);
      setCurrentNode(payload.currentNode);
      setTotalEndings(payload.quest.meta.totalEndings);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "quest_load_failed");
    } finally {
      setIsLoading(false);
    }
  }, [questId]);

  useEffect(() => {
    void loadQuestState();
  }, [loadQuestState]);

  const endingsDiscovered = progress?.endingsReached.length ?? 0;
  const isEnding = currentNode?.type === "ending";
  const displayNodeTitle =
    currentNode?.type === "ending" ? currentNode.title.replace(/^Ending:\s*/i, "").trim() : (currentNode?.title ?? "");
  const replayHint = useMemo(() => {
    if (lastEndingState?.replayHint?.trim()) {
      return lastEndingState.replayHint.trim();
    }
    if (isEnding && currentNode.type === "ending" && currentNode.ending.replayHint?.trim()) {
      return currentNode.ending.replayHint.trim();
    }
    return t("quests.endingReplayHintDefault");
  }, [currentNode, isEnding, lastEndingState?.replayHint, t]);

  useEffect(() => {
    if (!currentNode?.audio || audioPausedByUser) {
      return;
    }
    const audio = audioElementRef.current;
    if (!audio) {
      return;
    }
    suppressNextPausePersistRef.current = true;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay failures; controls remain available for manual play.
    });
  }, [audioPausedByUser, currentNode?.audio, currentNode?.id]);

  async function onStartQuest() {
    setIsStarting(true);
    setError("");
    try {
      const response = await fetch(`/api/quests/${encodeURIComponent(questId)}/start`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `QUEST_START_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as {
        progress: QuestProgress;
        walletBalance: number;
        currentNode: QuestRuntimeNode;
      };
      setProgress(payload.progress);
      setWalletBalance(payload.walletBalance);
      setCurrentNode(payload.currentNode);
      setLastEndingState(null);
      setLastTransaction(null);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "quest_start_failed");
    } finally {
      setIsStarting(false);
    }
  }

  async function onChoose(choiceId: string) {
    setPendingChoiceId(choiceId);
    setError("");
    try {
      const response = await fetch(`/api/quests/${encodeURIComponent(questId)}/choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choiceId,
          purchaseIfMissing: true,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `QUEST_CHOOSE_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as ChooseResponse;
      setProgress(payload.progress);
      setWalletBalance(payload.walletBalance);
      setCurrentNode(payload.currentNode);
      setLastEndingState(payload.ending);
      setLastTransaction(payload.transaction);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "quest_choice_failed");
    } finally {
      setPendingChoiceId("");
    }
  }

  async function onReplay() {
    setError("");
    try {
      const response = await fetch(`/api/quests/${encodeURIComponent(questId)}/replay`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `QUEST_REPLAY_HTTP_${response.status}`);
      }
      await onStartQuest();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "quest_replay_failed");
    }
  }

  function getChoiceIcon(choice: QuestChoiceRuntime): string {
    if (!choice.requiredItemId) {
      return "?";
    }
    if (!choice.allowPurchaseIfMissing) {
      return choice.consumeItem ? "🗝" : "🎒";
    }
    if (choice.purchaseAndUseImmediately) {
      return "⚡";
    }
    return "🛒";
  }

  function handleAudioPlay() {
    suppressNextPausePersistRef.current = false;
    setAudioPausedByUser(false);
    try {
      window.localStorage.setItem(QUEST_AUDIO_PAUSED_STORAGE_KEY, "0");
    } catch {
      // Ignore storage failures; in-memory state still updates.
    }
  }

  function handleAudioPause(event: SyntheticEvent<HTMLAudioElement>) {
    if (suppressNextPausePersistRef.current) {
      suppressNextPausePersistRef.current = false;
      return;
    }
    if (event.currentTarget.ended) {
      return;
    }
    setAudioPausedByUser(true);
    try {
      window.localStorage.setItem(QUEST_AUDIO_PAUSED_STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures; in-memory state still updates.
    }
  }

  if (isLoading) {
    return <p className="small">{t("quests.loadingQuest")}</p>;
  }

  if (error && !currentNode) {
    return <Alert>{t("quests.loadQuestError", { error })}</Alert>;
  }

  return (
    <section className="quest-reader">
      {error ? <Alert>{error}</Alert> : null}
      <div className="quest-reader-header">
        <h2>{questTitle}</h2>
        <p className="small quest-reader-endings">
          <span aria-hidden="true" className="quest-reader-endings-icon">
            *
          </span>
          {t("quests.endingsDiscovered", { found: endingsDiscovered, total: totalEndings })}
        </p>
      </div>

      {progress?.status === "not_started" ? (
        <div className="quest-start-wrap">
          <p className="small">{t("quests.startPrompt")}</p>
          <Button type="button" className="btn btn-primary" disabled={isStarting} onClick={() => void onStartQuest()}>
            {isStarting ? t("quests.startingQuest") : t("quests.startQuest")}
          </Button>
        </div>
      ) : null}

      {currentNode ? (
        <article className="quest-reader-node">
          <div className="quest-reader-hero">
            <img
              src={currentNode.image || "/assets/quests/template/images/cover-placeholder.png"}
              alt={currentNode.title}
              className="quest-reader-image"
              onError={(event) => {
                event.currentTarget.src = "/assets/quests/template/images/cover-placeholder.png";
              }}
            />
            <div className="quest-reader-hero-copy">
              <h3>{displayNodeTitle}</h3>
              <p>{currentNode.text}</p>
            </div>
          </div>
          {currentNode.audio ? (
            <audio
              key={`${currentNode.id}:${currentNode.audio}`}
              ref={audioElementRef}
              controls
              autoPlay={!audioPausedByUser}
              className="quest-reader-audio"
              onPlay={handleAudioPlay}
              onPause={handleAudioPause}>
              <source src={currentNode.audio} />
              {t("quests.narrationComingSoon")}
            </audio>
          ) : (
            <p className="small">{t("quests.narrationComingSoon")}</p>
          )}

          {currentNode.type === "story" ? (
            <div className="quest-reader-choices">
              {currentNode.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="quest-choice-card"
                  disabled={choice.disabled || pendingChoiceId.length > 0}
                  onClick={() => void onChoose(choice.id)}>
                  <span className="quest-choice-item">
                    <span className="quest-choice-icon-wrap" aria-hidden="true">
                      <span className="quest-choice-item-icon">{getChoiceIcon(choice)}</span>
                      {choice.madeBefore ? <span className="quest-choice-made-before-check">✓</span> : null}
                    </span>
                    <span>
                      <span className="quest-choice-action">{choice.label}</span>
                      <span className="small">{choice.description}</span>
                      {choice.requiredItemId ? (
                        <span className="small">
                          {t("quests.choiceItem", {
                            name: choice.requiredItemName,
                            status: choice.owned
                              ? t("quests.choiceOwned", { count: choice.ownedQuantity })
                              : t("quests.choiceMissing"),
                          })}
                          {!choice.owned && choice.purchasable
                            ? ` | ${t("quests.choicePrice", { price: choice.price })}`
                            : ""}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="quest-choice-cta">
                    {pendingChoiceId === choice.id ? t("quests.choiceWorking") : t("common.actions.continue")}
                    {pendingChoiceId === choice.id ? null : <span className="quest-choice-cta-arrow">&rarr;</span>}
                  </span>
                  {choice.disabled ? <span className="small">{choice.unavailableText}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="quest-ending-wrap">
              <p className="small">
                {lastEndingState?.isNewEnding ? t("quests.endingNew") : t("quests.endingSeen")}
              </p>
              <p className="small">{t("quests.endingProgress", { found: endingsDiscovered, total: totalEndings })}</p>
              <p className="small">{currentNode.ending.rewardSummary}</p>
              {lastTransaction ? (
                <p className="small">
                  {t("quests.endingEarnedNow", { coins: lastTransaction.rewardCoins })}
                  {lastTransaction.rewardItemIds.length > 0
                    ? ` • Items: ${lastTransaction.rewardItemIds.join(", ")}`
                    : ""}
                  {lastTransaction.earnedAchievements.length > 0
                    ? ` • Achievements: ${lastTransaction.earnedAchievements.join(", ")}`
                    : ""}
                </p>
              ) : null}
              <p className="small">{replayHint}</p>
              <div className="quest-ending-actions">
                <Button type="button" className="btn btn-primary" onClick={() => void onReplay()}>
                  {t("quests.endingTryDifferentPath")}
                </Button>
                <Link href="/quests">
                  <Button type="button" className="btn btn-secondary">
                    {t("quests.backToQuests")}
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}


