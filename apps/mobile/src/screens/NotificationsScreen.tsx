import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  fetchMobileNotifications,
  markMobileNotificationsSeen,
  type MobileNotification,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { AppScreen, Badge, Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/ui";

const PAGE_SIZE = 30;

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
  // Lets the host refresh any unseen-count badge after this screen marks
  // notifications as seen.
  onSeenChanged?: () => void;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}

// Native Notifications screen. The profile menu used to deep-link to the web
// app at /notifications, which dropped the user out of the mobile shell.
export function NotificationsScreen({ right, onGoDashboard, onSeenChanged }: Props) {
  const { t } = useMobileLocale();
  const [items, setItems] = useState<MobileNotification[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // Ids already sent to the mark-seen endpoint, so paging back and forth does
  // not re-PATCH the same rows.
  const markedRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const result = await fetchMobileNotifications(nextPage, PAGE_SIZE);
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setUnseenCount(result.unseenCount);
        setPage(result.pagination.page ?? nextPage);
        setTotalPages(result.pagination.totalPages ?? 1);
        setTotal(result.pagination.total ?? result.items.length);
        setError("");

        // Same behaviour as the web page: opening the list marks what you can
        // see as read.
        const toMark = result.items
          .filter((item) => !item.seen && !markedRef.current.has(item.id))
          .map((item) => item.id);
        if (toMark.length > 0) {
          toMark.forEach((id) => markedRef.current.add(id));
          try {
            await markMobileNotificationsSeen(toMark);
            setItems((current) =>
              current.map((item) => (toMark.includes(item.id) ? { ...item, seen: true } : item)),
            );
            setUnseenCount((current) => Math.max(0, current - toMark.length));
            onSeenChanged?.();
          } catch {
            // Leave the rows unseen; the next visit retries.
            toMark.forEach((id) => markedRef.current.delete(id));
          }
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "notifications_unavailable");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [onSeenChanged],
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

  return (
    <AppScreen
      title={t("nav.notifications")}
      subtitle={
        unseenCount > 0
          ? t("notificationsPage.subtitle.unseenCount", {
              count: String(unseenCount),
              suffix: unseenCount === 1 ? "y" : "ies",
            })
          : t("notificationsPage.subtitle.all")
      }
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {loading ? <LoadingState label={t("notificationsPage.loading")} /> : null}
      {error && items.length === 0 ? (
        <ErrorState message={t("notificationsPage.loadError", { error })} />
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState message={t("notificationsPage.empty")} />
      ) : null}

      {items.length > 0 ? (
        <Card>
          <View style={styles.list}>
            {items.map((item) => (
              <View key={item.id} style={[styles.row, item.seen ? null : styles.rowUnseen]}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>
                    {item.title || t("notificationsPage.fallback.title")}
                  </Text>
                  {!item.seen ? <View style={styles.unseenDot} /> : null}
                </View>
                <Text style={styles.rowMessage}>
                  {item.message || t("notificationsPage.fallback.message")}
                </Text>
                <View style={styles.rowMetaLine}>
                  <Badge label={item.kind} />
                  <Text style={styles.rowMeta}>{formatTimestamp(item.createdAt)}</Text>
                  <Text style={styles.rowMeta}>
                    {item.seen
                      ? t("notificationsPage.status.seen")
                      : t("notificationsPage.status.unseen")}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {page < totalPages ? (
            <Button
              label={loadingMore ? t("notificationsPage.loading") : t("notificationsPage.pager.next")}
              variant="secondary"
              disabled={loadingMore}
              onPress={() => void load(page + 1, true)}
            />
          ) : null}
          <Text style={styles.pagerText}>
            {t("notificationsPage.pager.pageOf", {
              page: String(page),
              totalPages: String(totalPages),
              total: String(total),
            })}
          </Text>
        </Card>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.sm,
  },
  rowUnseen: { borderColor: colors.brandStrong, backgroundColor: "#eef6ff" },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  unseenDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.brandStrong },
  rowMessage: { color: colors.text, fontSize: typography.small, fontWeight: "600" },
  rowMetaLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  rowMeta: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  pagerText: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
});
