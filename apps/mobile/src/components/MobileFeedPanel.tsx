import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { copyMobileFriendAward, fetchMobileFeed, type MobileFeedItem } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { AvatarBadge, Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/ui";

type MobileFeedPanelProps = {
  onViewChore?: () => void;
  onViewReward?: () => void;
  scope?: "all" | "friends";
  compact?: boolean;
};

const FEED_TYPE_EMOJI: Record<string, string> = {
  chore_created: "📝",
  chore_completed: "✅",
  chore_approved: "🌟",
  chore_rejected: "🔁",
  reward_claimed: "🎁",
  routine_completed: "🎉",
  title_unlocked: "🏅",
  family_award_created: "🎁",
};

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

export function MobileFeedPanel({ onViewChore, onViewReward, scope = "all", compact = false }: MobileFeedPanelProps) {
  const { locale, t } = useMobileLocale();
  const [items, setItems] = useState<MobileFeedItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [copyPendingId, setCopyPendingId] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
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
        <Text style={copyNotice === "copied" ? styles.success : styles.error}>
          {copyNotice === "copied" ? t("familyFriends.awards.copied") : t("familyFriends.errors.action", { error: copyNotice })}
        </Text>
      ) : null}
      {items.map((item) => {
        const emoji = FEED_TYPE_EMOJI[item.type] ?? "•";
        const handleAction =
          item.action === "view_reward" ? onViewReward : item.action === "view_chore" ? onViewChore : undefined;
        const actionLabel =
          item.action === "view_reward" ? t("feed.actions.viewReward") : t("feed.actions.viewChore");
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
                  <Text style={styles.title}>{t(`feed.events.${item.type}`)}</Text>
                  <Text style={styles.time}>{formatRelativeTime(item.createdAt, locale, t("feed.justNow"))}</Text>
                </View>
                {item.sourceFamily?.isFriend ? (
                  <Text style={styles.friendFamily}>{t("familyFriends.feed.fromFamily", { family: item.sourceFamily.name })}</Text>
                ) : null}
                {item.message ? <Text style={styles.message}>{item.message}</Text> : null}
                {item.action && handleAction ? (
                  <Pressable onPress={handleAction} hitSlop={6}>
                    <Text style={styles.action}>{actionLabel}</Text>
                  </Pressable>
                ) : null}
                {item.action === "copy_friend_award" && item.sourceFamily?.isFriend && item.metadata?.rewardId ? (
                  <Button
                    label={copyPendingId === item.id ? t("familyFriends.awards.copying") : t("familyFriends.awards.copy")}
                    disabled={Boolean(copyPendingId)}
                    onPress={() => void copyAward(item)}
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
  action: { marginTop: 4, fontSize: typography.small, fontWeight: "800", color: colors.brand },
  sectionHeader: { marginBottom: spacing.xs },
  sectionTitle: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  sectionSubtitle: { fontSize: typography.small, color: colors.muted },
  friendFamily: { fontSize: typography.small, fontWeight: "800", color: colors.brand },
  success: { color: "#15803d", fontSize: typography.small, fontWeight: "700" },
  error: { color: "#b91c1c", fontSize: typography.small, fontWeight: "700" },
});
