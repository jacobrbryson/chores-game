import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import {
  copyMobileCommunityAward,
  fetchMobileCommunityAwards,
  toAppAssetUrl,
  voteMobileCommunityAward,
  type MobileCommunityAward,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

const SORT_OPTIONS = ["most_popular", "newest"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

type Props = {
  onAwardCopied?: () => void;
};

export function MobileCommunityAwardsLibrary({ onAwardCopied }: Props) {
  const { t } = useMobileLocale();
  const [awards, setAwards] = useState<MobileCommunityAward[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [sortIndex, setSortIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState("");

  const sort = useMemo<SortOption>(() => SORT_OPTIONS[sortIndex] ?? "most_popular", [sortIndex]);

  async function loadAwards(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const payload = await fetchMobileCommunityAwards({ page, q: submittedQuery, sort });
      setAwards(payload.awards);
      setTotal(payload.pagination.total);
      setTotalPages(Math.max(1, payload.pagination.totalPages));
      setError("");
    } catch (loadError) {
      setAwards([]);
      setError(loadError instanceof Error ? loadError.message : "community_awards_unavailable");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadAwards();
  }, [page, submittedQuery, sort]);

  async function runAwardAction(awardId: string, action: () => Promise<void>, copied = false) {
    if (pendingId) {
      return;
    }
    setPendingId(awardId);
    setError("");
    setNotice("");
    try {
      await action();
      if (copied) {
        setNotice(t("communityAwards.copySuccess"));
        onAwardCopied?.();
      }
      await loadAwards(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "community_award_action_failed");
    } finally {
      setPendingId("");
    }
  }

  return (
    <Card>
      <SectionHeader title={t("communityAwards.title")} />
      <Text style={styles.sectionSubtitle}>{t("communityAwards.subtitle")}</Text>
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("communityAwards.searchPlaceholder")}
          accessibilityLabel={t("communityAwards.searchLabel")}
          style={styles.searchInput}
        />
        <View style={styles.controlRow}>
          <Button
            label={t("communityAwards.search")}
            onPress={() => {
              setPage(1);
              setSubmittedQuery(query);
            }}
          />
          <Button
            label={t(`communityAwards.sort.${sort}`)}
            variant="secondary"
            onPress={() => {
              setPage(1);
              setSortIndex((current) => (current + 1) % SORT_OPTIONS.length);
            }}
          />
        </View>
      </View>
      {notice ? <Text style={styles.successText}>{notice}</Text> : null}
      {error ? <ErrorState message={t("communityAwards.loadError", { error })} /> : null}
      {loading ? <LoadingState label={t("common.status.loading")} /> : null}
      {!loading && !error && awards.length === 0 ? <EmptyState message={t("communityAwards.empty")} /> : null}
      {!loading && awards.length > 0 ? (
        <View style={styles.awardList}>
          {awards.map((award) => (
            <View key={award.id} style={styles.awardCard}>
              <Image
                source={{ uri: toAppAssetUrl(award.publicImagePath || "/rewards/screens.png") }}
                style={styles.awardImage}
              />
              <Text style={styles.awardTitle}>{award.publicTitle}</Text>
              <Text style={styles.awardDescription}>{award.publicDescription}</Text>
              <Text style={styles.awardMeta}>{t("communityAwards.coinAmount", { coins: award.publicCoinAmount })}</Text>
              <TagRow award={award} />
              <Text style={styles.awardMeta}>
                {t("communityAwards.metrics", { votes: award.voteCount, copies: award.copyCount })}
              </Text>
              <View style={styles.controlRow}>
                <Button
                  label={
                    pendingId === `vote:${award.id}`
                      ? t("communityAwards.voting")
                      : award.viewerVote
                        ? t("communityAwards.voted")
                        : t("communityAwards.vote")
                  }
                  disabled={pendingId.length > 0}
                  variant={award.viewerVote ? "secondary" : "primary"}
                  onPress={() => void runAwardAction(`vote:${award.id}`, () => voteMobileCommunityAward(award.id))}
                />
                <Button
                  label={pendingId === `copy:${award.id}` ? t("communityAwards.copying") : t("communityAwards.copy")}
                  disabled={pendingId.length > 0}
                  variant="secondary"
                  onPress={() => void runAwardAction(`copy:${award.id}`, () => copyMobileCommunityAward(award.id), true)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {!loading && totalPages > 1 ? (
        <View style={styles.pager}>
          <Button
            label={t("notifications.pager.previous")}
            variant="secondary"
            disabled={page <= 1}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
          />
          <Text style={styles.awardMeta}>{t("communityAwards.pageOf", { page, totalPages, total })}</Text>
          <Button
            label={t("notifications.pager.next")}
            variant="secondary"
            disabled={page >= totalPages}
            onPress={() => setPage((current) => Math.min(totalPages, current + 1))}
          />
        </View>
      ) : null}
    </Card>
  );
}

function TagRow({ award }: { award: MobileCommunityAward }) {
  const tags = [award.publicCategory, ...award.publicTags].filter(Boolean);
  if (tags.length === 0) {
    return null;
  }
  return (
    <View style={styles.tagRow}>
      {tags.map((tag) => (
        <Text key={tag} style={styles.tag}>{tag}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { gap: spacing.sm },
  sectionSubtitle: { color: colors.muted, fontSize: typography.small },
  controlRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  searchInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: "#ffffff",
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: typography.body,
  },
  successText: {
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.md,
    backgroundColor: "#f0fdf4",
    color: "#166534",
    fontSize: typography.small,
    fontWeight: "700",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  awardList: { gap: spacing.sm },
  awardCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: spacing.md,
    gap: spacing.sm,
  },
  awardImage: {
    width: "100%",
    height: 148,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    resizeMode: "cover",
  },
  awardTitle: { fontSize: typography.body, fontWeight: "800", color: colors.text },
  awardDescription: { fontSize: typography.small, color: colors.muted },
  awardMeta: { fontSize: typography.small, color: colors.muted, fontWeight: "700" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: {
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    color: colors.brandStrong,
    fontSize: typography.tiny,
    fontWeight: "800",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pager: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
});
