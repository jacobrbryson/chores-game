import React, { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  toAppAssetUrl,
  type MobileQuestChoice,
  type MobileQuestChoiceResult,
  type MobileQuestNode,
  type MobileQuestProgress,
} from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button, Card, ErrorState, LoadingState } from "@/components/ui";

const QUEST_PLACEHOLDER = "/assets/quests/template/images/cover-placeholder.png";

export type MobileQuestReaderState = {
  loading: boolean;
  error?: string;
  questTitle: string;
  progress: MobileQuestProgress | null;
  walletBalance: number;
  currentNode: MobileQuestNode | null;
  totalEndings: number;
  lastEnding: MobileQuestChoiceResult["ending"] | null;
  lastTransaction: MobileQuestChoiceResult["transaction"] | null;
};

type Props = {
  state: MobileQuestReaderState;
  isStarting: boolean;
  pendingChoiceId: string;
  isReplaying: boolean;
  onBack: () => void;
  onStart: () => Promise<void>;
  onChoose: (choiceId: string) => Promise<void>;
  onReplay: () => Promise<void>;
};

export function MobileQuestReader({ state, isStarting, pendingChoiceId, isReplaying, onBack, onStart, onChoose, onReplay }: Props) {
  const endingsDiscovered = state.progress?.endingsReached.length ?? 0;
  const replayHint = useMemo(() => {
    if (state.lastEnding?.replayHint?.trim()) {
      return state.lastEnding.replayHint.trim();
    }
    if (state.currentNode?.type === "ending" && state.currentNode.ending.replayHint?.trim()) {
      return state.currentNode.ending.replayHint.trim();
    }
    return "There are other paths to explore.";
  }, [state.currentNode, state.lastEnding]);

  if (state.loading) {
    return <LoadingState label="Loading quest..." />;
  }

  return (
    <View style={styles.stack}>
      <Button label="<- Back to Quests" variant="secondary" onPress={onBack} />
      {state.error ? <ErrorState message={state.error} /> : null}
      <Card style={styles.darkCard}>
        <View style={styles.readerHeader}>
          <View style={styles.readerTitleWrap}>
            <Text style={styles.readerKicker}>Quest</Text>
            <Text style={styles.readerTitle}>{state.questTitle || "Quest"}</Text>
          </View>
          <Badge label={`${endingsDiscovered}/${state.totalEndings} endings`} />
        </View>
        <Text style={styles.walletText}>{state.walletBalance} coins available</Text>
        {state.progress?.status === "not_started" ? (
          <View style={styles.startWrap}>
            <Text style={styles.bodyLight}>Start this quest to begin the interactive story.</Text>
            <Button label={isStarting ? "Starting..." : "Start Quest"} disabled={isStarting} onPress={() => void onStart()} />
          </View>
        ) : null}
        {state.currentNode ? (
          <QuestNodeCard
            node={state.currentNode}
            pendingChoiceId={pendingChoiceId}
            lastEnding={state.lastEnding}
            lastTransaction={state.lastTransaction}
            endingsDiscovered={endingsDiscovered}
            totalEndings={state.totalEndings}
            replayHint={replayHint}
            isReplaying={isReplaying}
            onChoose={onChoose}
            onReplay={onReplay}
          />
        ) : null}
      </Card>
    </View>
  );
}

function QuestNodeCard({
  node,
  pendingChoiceId,
  lastEnding,
  lastTransaction,
  endingsDiscovered,
  totalEndings,
  replayHint,
  isReplaying,
  onChoose,
  onReplay,
}: {
  node: MobileQuestNode;
  pendingChoiceId: string;
  lastEnding: MobileQuestChoiceResult["ending"] | null;
  lastTransaction: MobileQuestChoiceResult["transaction"] | null;
  endingsDiscovered: number;
  totalEndings: number;
  replayHint: string;
  isReplaying: boolean;
  onChoose: (choiceId: string) => Promise<void>;
  onReplay: () => Promise<void>;
}) {
  const displayTitle = node.type === "ending" ? node.title.replace(/^Ending:\s*/i, "").trim() : node.title;

  return (
    <View style={styles.nodeWrap}>
      <Image source={{ uri: toAppAssetUrl(node.image || QUEST_PLACEHOLDER) }} style={styles.nodeImage} />
      <Text style={styles.nodeTitle}>{displayTitle}</Text>
      <Text style={styles.bodyLight}>{node.text}</Text>
      {node.audio ? <Text style={styles.mutedLight}>Narration is available in the web player.</Text> : <Text style={styles.mutedLight}>Narration coming soon.</Text>}
      {node.type === "story" ? (
        <View style={styles.choiceList}>
          {node.choices.map((choice) => (
            <QuestChoiceButton
              key={choice.id}
              choice={choice}
              disabled={choice.disabled || pendingChoiceId.length > 0}
              working={pendingChoiceId === choice.id}
              onChoose={onChoose}
            />
          ))}
        </View>
      ) : (
        <View style={styles.endingWrap}>
          <Text style={styles.bodyLight}>{lastEnding?.isNewEnding ? "New ending discovered!" : "Previously discovered ending."}</Text>
          <Text style={styles.bodyLight}>You've discovered {endingsDiscovered} of {totalEndings} endings.</Text>
          <Text style={styles.bodyLight}>{node.ending.rewardSummary}</Text>
          {lastTransaction ? <Text style={styles.bodyLight}>{formatTransaction(lastTransaction)}</Text> : null}
          <Text style={styles.mutedLight}>{replayHint}</Text>
          <Button label={isReplaying ? "Restarting..." : "Try a Different Path"} disabled={isReplaying} onPress={() => void onReplay()} />
        </View>
      )}
    </View>
  );
}

function QuestChoiceButton({
  choice,
  disabled,
  working,
  onChoose,
}: {
  choice: MobileQuestChoice;
  disabled: boolean;
  working: boolean;
  onChoose: (choiceId: string) => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => void onChoose(choice.id)}
      style={({ pressed }) => [styles.choiceCard, disabled && styles.choiceDisabled, pressed && !disabled && styles.pressed]}
    >
      <View style={styles.choiceTop}>
        <View style={styles.choiceIconWrap}>
          <Text style={styles.choiceIcon}>{getChoiceIcon(choice)}</Text>
          {choice.madeBefore ? <Text style={styles.choiceCheck}>{"\u2713"}</Text> : null}
        </View>
        <View style={styles.choiceCopy}>
          <Text style={styles.choiceTitle}>{choice.label}</Text>
          <Text style={styles.choiceDesc}>{choice.description}</Text>
        </View>
      </View>
      {choice.requiredItemId ? (
        <View style={styles.itemRow}>
          <Image source={{ uri: toAppAssetUrl(choice.requiredItemImage || "/assets/items/placeholder.png") }} style={styles.itemImage} />
          <Text style={styles.choiceDesc}>
            {choice.requiredItemName}: {choice.owned ? `Owned (${choice.ownedQuantity})` : "Missing"}
            {!choice.owned && choice.purchasable ? ` | ${choice.price} coins` : ""}
          </Text>
        </View>
      ) : null}
      <Text style={styles.choiceCta}>{working ? "Working..." : choice.actionText || "Continue"} {">"}</Text>
      {choice.disabled ? <Text style={styles.unavailableText}>{choice.unavailableText}</Text> : null}
    </Pressable>
  );
}

function getChoiceIcon(choice: MobileQuestChoice) {
  if (!choice.requiredItemId) {
    return "?";
  }
  if (!choice.allowPurchaseIfMissing) {
    return choice.consumeItem ? "Key" : "Bag";
  }
  if (choice.purchaseAndUseImmediately) {
    return "Zap";
  }
  return "Buy";
}

function formatTransaction(transaction: MobileQuestChoiceResult["transaction"]) {
  const parts = [`Earned now: +${transaction.rewardCoins} coins`];
  if (transaction.spentCoins > 0) {
    parts.push(`Spent: ${transaction.spentCoins} coins`);
  }
  if (transaction.rewardItemIds.length > 0) {
    parts.push(`Items: ${transaction.rewardItemIds.join(", ")}`);
  }
  if (transaction.earnedAchievements.length > 0) {
    parts.push(`Achievements: ${transaction.earnedAchievements.join(", ")}`);
  }
  return parts.join(" | ");
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  darkCard: { backgroundColor: colors.questDark, borderColor: "#334155", gap: spacing.lg },
  readerHeader: { flexDirection: "row", gap: spacing.md, justifyContent: "space-between", alignItems: "flex-start" },
  readerTitleWrap: { flex: 1, gap: spacing.xs },
  readerKicker: { color: "#93c5fd", fontSize: typography.tiny, fontWeight: "900", textTransform: "uppercase" },
  readerTitle: { color: "#f8fafc", fontSize: 24, lineHeight: 30, fontWeight: "900" },
  walletText: { color: "#fef3c7", fontSize: typography.small, fontWeight: "800" },
  startWrap: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: "#111827" },
  nodeWrap: { gap: spacing.md },
  nodeImage: { width: "100%", height: 230, borderRadius: radius.lg, backgroundColor: "#111827" },
  nodeTitle: { color: "#f8fafc", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  bodyLight: { color: "#e2e8f0", fontSize: typography.body, lineHeight: 23 },
  mutedLight: { color: "#94a3b8", fontSize: typography.small, lineHeight: 20 },
  choiceList: { gap: spacing.md },
  choiceCard: {
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: "#111827",
    gap: spacing.sm,
  },
  choiceDisabled: { opacity: 0.58 },
  choiceTop: { flexDirection: "row", gap: spacing.md },
  choiceIconWrap: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dbeafe",
  },
  choiceIcon: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "900" },
  choiceCheck: {
    position: "absolute",
    right: -2,
    bottom: -2,
    color: "#fff",
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: 5,
    fontSize: typography.tiny,
    fontWeight: "900",
  },
  choiceCopy: { flex: 1, gap: spacing.xs },
  choiceTitle: { color: "#f8fafc", fontSize: typography.body, fontWeight: "900" },
  choiceDesc: { color: "#cbd5e1", fontSize: typography.small, lineHeight: 19 },
  choiceCta: { color: "#93c5fd", fontSize: typography.small, fontWeight: "900", textAlign: "right" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemImage: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: "#1e293b" },
  unavailableText: { color: "#fecaca", fontSize: typography.small, fontWeight: "700" },
  endingWrap: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: "#111827" },
  pressed: { transform: [{ scale: 0.985 }] },
});
