import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { copyMobileFriendAward, fetchMobileFeed, type MobileFeedItem } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { AvatarBadge, Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { MobileCopyFriendRoutineModal } from "@/components/MobileCopyFriendRoutineModal";

type MobileFeedPanelProps = {
  scope?: "all" | "friends";
  compact?: boolean;
};

const FEED_TYPE_EMOJI: Record<string, string> = {
  chore_created: "📝",
  chore_completed: "✅",
  chore_approved: "🌟",
  chore_rejected: "🔁",
  reward_claimed: "🎁",
  routine_created: "📋",
  routine_completed: "🎉",
  title_unlocked: "🏅",
  family_award_created: "🎁",
};

// Cosmetic flair tier for a daily roll-up, mirroring feedDayRollupTier on the web.
function dayRollupTier(choreCount: number) {
  if (choreCount >= 10) {
    return "unstoppable";
  }
  if (choreCount >= 6) {
    return "fire";
  }
  return choreCount >= 3 ? "roll" : "steady";
}

function localDayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// "today" / "yesterday" / "on Aug 14" for a YYYY-MM-DD roll-up day. Parsed at
// noon so the label never slips a day across timezones.
function formatDayLabel(
  day: string,
  locale: string,
  t: (key: string, params?: Record<string, string>) => string,
) {
  const now = new Date();
  if (day === localDayKey(now)) {
    return t("feed.dayRollup.today");
  }
  if (day === localDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) {
    return t("feed.dayRollup.yesterday");
  }
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return day;
  }
  try {
    return t("feed.dayRollup.onDate", {
      date: parsed.toLocaleDateString(locale, { month: "short", day: "numeric" }),
    });
  } catch {
    return t("feed.dayRollup.onDate", { date: day });
  }
}

function avatarUrl(avatarId: string, avatarPhotoUrl: string) {
  if (avatarPhotoUrl) {
    return avatarPhotoUrl;
  }
  if (!avatarId) {
    return "";
  }
  const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, "") ?? "http://localhost:3000";
  return `${base}/avatars/default/${encodeURIComponent(avatarId)}`;
}

function formatRelativeTime(value: string, locale: string, fallback: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
      { amount: 60, unit: "second" },
      { amount: 60, unit: "minute" },
      { amount: 24, unit: "hour" },
      { amount: 7, unit: "day" },
      { amount: 4.34524, unit: "week" },
      { amount: 12, unit: "month" },
      { amount: Number.POSITIVE_INFINITY, unit: "year" },
    ];
    let duration = (parsed - Date.now()) / 1000;
    for (const division of divisions) {
      if (Math.abs(duration) < division.amount) {
        return formatter.format(Math.round(duration), division.unit);
      }
      duration /= division.amount;
    }
  } catch {
    // Intl.RelativeTimeFormat may be unavailable on some native runtimes.
  }
  try {
    return new Date(parsed).toLocaleDateString(locale);
  } catch {
    return fallback;
  }
}

export function MobileFeedPanel({
  scope = "all",
  compact = false,
}: MobileFeedPanelProps) {
  const { locale, t } = useMobileLocale();
  const [items, setItems] = useState<MobileFeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [copyPendingId, setCopyPendingId] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [routineToCopy, setRoutineToCopy] = useState<MobileFeedItem | null>(null);
  const requestSeqRef = useRef(0);

  const load = useCallback(async (targetPage: number, mode: "replace" | "append") => {
    if (mode === "append") {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    try {
      const result = await fetchMobileFeed(targetPage, compact ? 3 : 20, scope);
      if (seq !== requestSeqRef.current) {
        return;
      }
      setItems((current) => (mode === "append" ? [...current, ...result.items] : result.items));
      setHasMore(result.pagination.hasMore);
      setPage(result.pagination.page);
    } catch (loadError) {
      if (seq !== requestSeqRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "feed_unavailable");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [compact, scope]);

  useEffect(() => {
    void load(1, "replace");
  }, [load]);

  if (loading) {
    return <LoadingState label={t("feed.loading")} />;
  }
  if (error) {
    return <ErrorState message={t("feed.loadError", { error })} />;
  }
  if (items.length === 0) {
    if (compact) return null;
    return <EmptyState message={t("feed.emptyBody")} />;
  }

  async function copyAward(item: MobileFeedItem) {
    const sourceFamilyId = item.sourceFamily?.isFriend ? item.sourceFamily.id : "";
    const rewardId = item.metadata?.rewardId || "";
    if (!sourceFamilyId || !rewardId || copyPendingId) return;
    setCopyPendingId(item.id);
    setCopyNotice("");
    try {
      await copyMobileFriendAward(sourceFamilyId, rewardId);
      setCopyNotice("copied");
    } catch (copyError) {
      setCopyNotice(copyError instanceof Error ? copyError.message : "friend_award_copy_failed");
    } finally {
      setCopyPendingId("");
    }
  }

  return (
    <View style={styles.list}>
      {compact ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("familyFriends.latest.title")}</Text>
          <Text style={styles.sectionSubtitle}>{t("familyFriends.latest.description")}</Text>
        </View>
      ) : null}
      {copyNotice ? (
        <Text style={["copied", "routine_copied", "routine_copied_assigned"].includes(copyNotice) ? styles.success : styles.error}>
          {copyNotice === "copied"
            ? t("familyFriends.awards.copied")
            : copyNotice === "routine_copied"
              ? t("familyFriends.routines.copied")
              : copyNotice === "routine_copied_assigned"
                ? t("familyFriends.routines.copiedAssigned")
                : t("familyFriends.errors.action", { error: copyNotice })}
        </Text>
      ) : null}
      {items.map((item) => {
        const emoji = FEED_TYPE_EMOJI[item.type] ?? "•";
        // Feed cards carry no destination link. A card can describe another
        // family's activity (friend feed), and a day roll-up stands in for many
        // chores at once, so no single "view chore"/"view reward" screen is the
        // right target. Real actions (copy award / copy routine) stay as buttons.
        // A finished routine and a daily roll-up both replace the per-chore cards
        // they cover, so both list the chores instead.
        const dayChores = item.metadata?.dayChores ?? [];
        const listedChores = dayChores.length
          ? dayChores
          : item.type === "routine_completed"
            ? item.metadata?.routineSteps ?? []
            : [];
        const isDayRollup = dayChores.length > 0 && Boolean(item.metadata?.day);
        const isAddedRollup = isDayRollup && item.metadata?.dayKind === "created";
        const cardTitle = isAddedRollup
          ? t("feed.dayRollup.titleAdded")
          : isDayRollup
            ? t("feed.dayRollup.title")
            : t(`feed.events.${item.type}`);
        // The server sends an English headline for older clients; render the
        // localized one here from the same metadata.
        const rollupKey = isAddedRollup ? "added" : dayRollupTier(dayChores.length);
        const message = isDayRollup
          ? t(`feed.dayRollup.${rollupKey}`, {
              name: item.actor?.name ?? "",
              count: String(item.metadata?.dayChoreCount ?? dayChores.length),
              when: formatDayLabel(item.metadata?.day ?? "", locale, t),
            })
          : item.message;
        return (
          <Card key={item.id} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.iconWrap}>
                {item.actor ? (
                  <AvatarBadge
                    name={item.actor.name}
                    imageUrl={avatarUrl(item.actor.avatarId, item.actor.avatarPhotoUrl)}
                    color={item.actor.primaryColor || undefined}
                    size={40}
                  />
                ) : (
                  <View style={styles.emojiCircle}>
                    <Text style={styles.emoji}>{emoji}</Text>
                  </View>
                )}
                <View style={styles.badge}>
                  <Text style={styles.badgeEmoji}>{emoji}</Text>
                </View>
              </View>
              <View style={styles.body}>
                <View style={styles.headline}>
                  <Text style={styles.title}>{cardTitle}</Text>
                  <Text style={styles.time}>{formatRelativeTime(item.createdAt, locale, t("feed.justNow"))}</Text>
                </View>
                {item.sourceFamily?.isFriend ? (
                  <Text style={styles.friendFamily}>{t("familyFriends.feed.fromFamily", { family: item.sourceFamily.name })}</Text>
                ) : null}
                {message ? <Text style={styles.message}>{message}</Text> : null}
                {listedChores.length ? (
                  <View style={styles.steps}>
                    {listedChores.map((step, index) => (
                      <View key={step.choreId || `${item.id}-step-${index}`} style={styles.step}>
                        <Text style={styles.stepEmoji}>{step.skipped ? "⏭️" : "✅"}</Text>
                        <Text style={step.skipped ? styles.stepTitleSkipped : styles.stepTitle}>
                          {step.title}
                        </Text>
                        <Text style={styles.stepMeta}>
                          {step.skipped
                            ? t("feed.routineSteps.skipped")
                            : step.coinValue > 0
                              ? t("feed.routineSteps.coins", { coins: String(step.coinValue) })
                              : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {item.action === "copy_friend_award" && item.sourceFamily?.isFriend && item.metadata?.rewardId ? (
                  <Button
                    label={copyPendingId === item.id ? t("familyFriends.awards.copying") : t("familyFriends.awards.copy")}
                    disabled={Boolean(copyPendingId)}
                    onPress={() => void copyAward(item)}
                  />
                ) : null}
                {item.action === "copy_friend_routine" &&
                item.sourceFamily?.isFriend &&
                (item.metadata?.routineId || item.metadata?.routineName) ? (
                  <Button
                    label={t("familyFriends.routines.cta")}
                    onPress={() => {
                      setCopyNotice("");
                      setRoutineToCopy(item);
                    }}
                  />
                ) : null}
              </View>
            </View>
          </Card>
        );
      })}
      {hasMore && !compact ? (
        <Button
          label={loadingMore ? t("feed.loadingMore") : t("feed.loadMore")}
          variant="secondary"
          disabled={loadingMore}
          onPress={() => void load(page + 1, "append")}
        />
      ) : null}
      <MobileCopyFriendRoutineModal
        visible={Boolean(routineToCopy)}
        sourceFamilyId={routineToCopy?.sourceFamily?.id ?? ""}
        sourceFamilyName={routineToCopy?.sourceFamily?.name ?? ""}
        sourceRoutineId={routineToCopy?.metadata?.routineId ?? ""}
        routineName={routineToCopy?.metadata?.routineName ?? ""}
        onClose={() => setRoutineToCopy(null)}
        onCopied={(assigned) => setCopyNotice(assigned ? "routine_copied_assigned" : "routine_copied")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { paddingVertical: spacing.md },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  iconWrap: { width: 40, height: 40 },
  emojiCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 20 },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeEmoji: { fontSize: 11 },
  body: { flex: 1, minWidth: 0, gap: 2 },
  headline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, fontSize: typography.body, fontWeight: "800", color: colors.brandStrong },
  time: { fontSize: typography.small, color: colors.muted },
  message: { fontSize: typography.small, color: colors.text },
  steps: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.accentSoft,
    gap: 4,
  },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  stepEmoji: { fontSize: typography.small },
  stepTitle: { flex: 1, fontSize: typography.small, color: colors.text },
  stepTitleSkipped: {
    flex: 1,
    fontSize: typography.small,
    color: colors.muted,
    textDecorationLine: "line-through",
  },
  stepMeta: { fontSize: typography.small, color: colors.muted },
  sectionHeader: { marginBottom: spacing.xs },
  sectionTitle: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  sectionSubtitle: { fontSize: typography.small, color: colors.muted },
  friendFamily: { fontSize: typography.small, fontWeight: "800", color: colors.brand },
  success: { color: "#15803d", fontSize: typography.small, fontWeight: "700" },
  error: { color: "#b91c1c", fontSize: typography.small, fontWeight: "700" },
});
