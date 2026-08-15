import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { toAppAssetUrl, type MobileQuestLibraryEntry } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

const QUEST_PLACEHOLDER = "/assets/quests/template/images/cover-placeholder.png";

export type MobileQuestLibraryState = {
  loading: boolean;
  error?: string;
  items: MobileQuestLibraryEntry[];
  hasUnlockedQuestPack: boolean;
};

type Props = {
  state: MobileQuestLibraryState;
  onRefresh: () => Promise<void>;
  onOpenQuest: (questId: string) => Promise<void>;
};

export function MobileQuestLibrary({ state, onRefresh, onOpenQuest }: Props) {
  const { t } = useMobileLocale();
  const featuredQuest = state.items[0] ?? null;
  const continuingQuests = state.items.filter((quest) => quest.completionStatus === "in_progress");
  const completedQuests = state.items.filter((quest) => quest.completionStatus === "completed");

  if (state.loading) {
    return <LoadingState label={t("quests.loadingQuest")} />;
  }

  if (state.error) {
    return (
      <View style={styles.stack}>
        <ErrorState message={t("quests.loadQuestError", { error: state.error })} />
        <Button label={t("common.actions.retry")} variant="secondary" onPress={() => void onRefresh()} />
      </View>
    );
  }

  if (state.items.length === 0) {
    return <EmptyState message={t("quests.noQuests")} />;
  }

  return (
    <View style={styles.stack}>
      {featuredQuest ? <FeaturedQuest quest={featuredQuest} hasUnlockedQuestPack={state.hasUnlockedQuestPack} onOpenQuest={onOpenQuest} /> : null}
      {continuingQuests.length > 0 ? <QuestRail title={t("quests.continueWatching")} quests={continuingQuests} onOpenQuest={onOpenQuest} /> : null}
      <QuestRail title={state.hasUnlockedQuestPack ? t("quests.questLibrary") : t("quests.availableNow")} quests={state.items} onOpenQuest={onOpenQuest} />
      {completedQuests.length > 0 ? <QuestRail title={t("quests.completed")} quests={completedQuests} onOpenQuest={onOpenQuest} /> : null}
      {!state.hasUnlockedQuestPack ? <LockedQuestRail /> : null}
    </View>
  );
}

function FeaturedQuest({
  quest,
  hasUnlockedQuestPack,
  onOpenQuest,
}: {
  quest: MobileQuestLibraryEntry;
  hasUnlockedQuestPack: boolean;
  onOpenQuest: (questId: string) => Promise<void>;
}) {
  const { t } = useMobileLocale();

  return (
    <Card style={styles.heroCard}>
      <Image source={{ uri: toAppAssetUrl(quest.coverImage || QUEST_PLACEHOLDER) }} style={styles.heroImage} />
      <View style={styles.heroOverlay}>
        <Badge label={t("quests.featuredQuest")} />
        <Text style={styles.heroTitle}>{quest.title}</Text>
        {quest.summary ? <Text style={styles.heroSummary}>{quest.summary}</Text> : null}
        <Text style={styles.heroMeta}>
          Ages {quest.ageRange || "all"} | {quest.estimatedMinutes ?? "?"} min | {quest.difficulty || "story"}
        </Text>
        <Button label={`${quest.actionLabel ?? "Start"} ->`} onPress={() => void onOpenQuest(quest.questId)} disabled={quest.locked} />
        {!hasUnlockedQuestPack ? <Text style={styles.mutedLight}>Start this quest to unlock 5 more quests.</Text> : null}
      </View>
    </Card>
  );
}

function QuestRail({
  title,
  quests,
  onOpenQuest,
}: {
  title: string;
  quests: MobileQuestLibraryEntry[];
  onOpenQuest: (questId: string) => Promise<void>;
}) {
  return (
    <View style={styles.railWrap}>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {quests.map((quest) => (
          <QuestTile key={`${title}-${quest.questId}`} quest={quest} onOpenQuest={onOpenQuest} />
        ))}
      </ScrollView>
    </View>
  );
}

function QuestTile({ quest, onOpenQuest }: { quest: MobileQuestLibraryEntry; onOpenQuest: (questId: string) => Promise<void> }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={quest.locked}
      onPress={() => void onOpenQuest(quest.questId)}
      style={({ pressed }) => [styles.tile, quest.locked && styles.tileLocked, pressed && !quest.locked && styles.pressed]}
    >
      <Image source={{ uri: toAppAssetUrl(quest.coverImage || QUEST_PLACEHOLDER) }} style={styles.tileImage} />
      <View style={styles.tileMeta}>
        <Text style={styles.tileTitle} numberOfLines={2}>{quest.title}</Text>
        <Text style={styles.tileSub}>
          {quest.locked ? "Coming Soon!" : `${formatStatus(quest.completionStatus)} | ${quest.endingsDiscovered ?? 0}/${quest.totalEndings ?? 0}`}
        </Text>
      </View>
    </Pressable>
  );
}

function LockedQuestRail() {
  const { t } = useMobileLocale();

  return (
    <View style={styles.railWrap}>
      <SectionHeader title={t("quests.lockedQuests")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {Array.from({ length: 5 }).map((_, index) => (
          <View key={`locked-${index}`} style={[styles.tile, styles.tileLocked]}>
            <View style={styles.lockedImage}><Text style={styles.lockedIcon}>?</Text></View>
            <View style={styles.tileMeta}>
              <Text style={styles.tileTitle}>Quest {index + 2}</Text>
              <Text style={styles.tileSub}>Unlock by progressing quest 1</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  heroCard: { overflow: "hidden", padding: 0, backgroundColor: colors.questDark, borderColor: "#334155" },
  heroImage: { width: "100%", height: 260, backgroundColor: "#111827" },
  heroOverlay: { gap: spacing.sm, padding: spacing.lg, backgroundColor: "rgba(11, 18, 32, 0.94)" },
  heroTitle: { color: "#f8fafc", fontSize: 28, lineHeight: 34, fontWeight: "900" },
  heroSummary: { color: "#dbeafe", fontSize: typography.body, lineHeight: 22 },
  heroMeta: { color: "#bfdbfe", fontSize: typography.small, fontWeight: "700" },
  mutedLight: { color: "#94a3b8", fontSize: typography.small, lineHeight: 20 },
  railWrap: { gap: spacing.sm },
  rail: { gap: spacing.md, paddingRight: spacing.lg },
  tile: {
    width: 190,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
  },
  tileLocked: { opacity: 0.64 },
  tileImage: { width: "100%", height: 112, backgroundColor: "#111827" },
  lockedImage: { width: "100%", height: 112, backgroundColor: "#1e293b", alignItems: "center", justifyContent: "center" },
  lockedIcon: { color: "#94a3b8", fontSize: 30, fontWeight: "900" },
  tileMeta: { padding: spacing.sm, gap: spacing.xs },
  tileTitle: { color: "#f8fafc", fontSize: typography.body, fontWeight: "900" },
  tileSub: { color: "#94a3b8", fontSize: typography.small, textTransform: "capitalize" },
  pressed: { transform: [{ scale: 0.985 }] },
});
