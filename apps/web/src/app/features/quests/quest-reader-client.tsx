"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type QuestChoiceRuntime = {
  id: string;
  label: string;
  description: string;
  requiredItemId: string;
  requiredItemName: string;
  requiredItemImage: string;
  consumeItem: boolean;
  purchasable: boolean;
  canAfford: boolean;
  price: number;
  ownedQuantity: number;
  owned: boolean;
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

export function QuestReaderClient({ questId }: QuestReaderClientProps) {
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
  const replayHint = useMemo(() => {
    if (lastEndingState?.replayHint?.trim()) {
      return lastEndingState.replayHint.trim();
    }
    if (isEnding && currentNode.type === "ending" && currentNode.ending.replayHint?.trim()) {
      return currentNode.ending.replayHint.trim();
    }
    return "There are other paths to explore.";
  }, [currentNode, isEnding, lastEndingState?.replayHint]);

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

  if (isLoading) {
    return <p className="small">Loading quest...</p>;
  }

  if (error && !currentNode) {
    return <Alert>Could not load quest: {error}</Alert>;
  }

  return (
    <section className="quest-reader">
      {error ? <Alert>{error}</Alert> : null}
      <div className="quest-reader-header">
        <h2>{questTitle}</h2>
        <p className="small">
          Coins: {walletBalance} • Endings discovered: {endingsDiscovered}/{totalEndings}
        </p>
      </div>

      {progress?.status === "not_started" ? (
        <div className="quest-start-wrap">
          <p className="small">Start this quest to begin the interactive story.</p>
          <Button type="button" className="btn btn-primary" disabled={isStarting} onClick={() => void onStartQuest()}>
            {isStarting ? "Starting..." : "Start Quest"}
          </Button>
        </div>
      ) : null}

      {currentNode ? (
        <article className="quest-reader-node">
          <img
            src={currentNode.image || "/assets/quests/template/images/cover-placeholder.png"}
            alt={currentNode.title}
            className="quest-reader-image"
            onError={(event) => {
              event.currentTarget.src = "/assets/quests/template/images/cover-placeholder.png";
            }}
          />
          <h3>{currentNode.title}</h3>
          <p>{currentNode.text}</p>
          {currentNode.audio ? (
            <audio controls className="quest-reader-audio">
              <source src={currentNode.audio} />
              Narration coming soon.
            </audio>
          ) : (
            <p className="small">Narration coming soon.</p>
          )}

          {currentNode.type === "story" ? (
            <div className="quest-reader-choices">
              {currentNode.choices.map((choice) => (
                <article key={choice.id} className="quest-choice-card">
                  <div className="quest-choice-item">
                    <img
                      src={choice.requiredItemImage || "/assets/items/placeholder.png"}
                      alt={choice.requiredItemName}
                      className="quest-choice-item-image"
                      onError={(event) => {
                        event.currentTarget.src = "/assets/items/placeholder.png";
                      }}
                    />
                    <div>
                      <h4>{choice.label}</h4>
                      <p className="small">{choice.description}</p>
                      <p className="small">
                        Item: {choice.requiredItemName} • {choice.owned ? `Owned (${choice.ownedQuantity})` : "Missing"}
                        {!choice.owned && choice.purchasable ? ` • ${choice.price} coins` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="btn btn-primary"
                    disabled={choice.disabled || pendingChoiceId.length > 0}
                    onClick={() => void onChoose(choice.id)}>
                    {pendingChoiceId === choice.id ? "Working..." : choice.actionText}
                  </Button>
                  {choice.disabled ? <p className="small">{choice.unavailableText}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="quest-ending-wrap">
              <p className="small">
                {lastEndingState?.isNewEnding ? "New ending discovered!" : "Previously discovered ending."}
              </p>
              <p className="small">You&apos;ve discovered {endingsDiscovered} of {totalEndings} endings.</p>
              <p className="small">{currentNode.ending.rewardSummary}</p>
              {lastTransaction ? (
                <p className="small">
                  Earned now: +{lastTransaction.rewardCoins} coins
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
                  Try a Different Path
                </Button>
                <Link href="/quests">
                  <Button type="button" className="btn btn-secondary">
                    Back to Quests
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
