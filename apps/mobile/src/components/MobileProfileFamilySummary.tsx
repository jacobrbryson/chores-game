import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useMobileLocale } from "@/lib/locale";
import { toAppAssetUrl, type MobileProfileSummary } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { Button, Card, EmptyState, SectionHeader } from "@/components/ui";

type Props = {
  summary: MobileProfileSummary | null;
  claimingAwardId?: string;
  onClaimAward?: (awardId: string) => void;
};

function humanizeCategory(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCategoryCounts(summary: MobileProfileSummary | null) {
  const byCategory = new Map<string, number>();
  for (const item of summary?.ownedItems ?? []) {
    if (item.category.trim().toLowerCase().includes("quest")) continue;
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + Math.max(0, item.quantity));
  }
  return Array.from(byCategory.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function MobileProfileFamilySummary({ summary, claimingAwardId = "", onClaimAward }: Props) {
  const { t } = useMobileLocale();
  const categoryCounts = buildCategoryCounts(summary);

  if (!summary) {
    return null;
  }

  return (
    <>
      <Card>
        <SectionHeader title={t("family.unclaimedAwards")} />
        <Text style={styles.subtle}>
          {t("family.pendingRewards", {
            count: summary.unclaimedAwards.length,
            suffix: summary.unclaimedAwards.length === 1 ? "" : "s",
          })}
        </Text>
        {summary.unclaimedAwards.length === 0 ? (
          <EmptyState message={t("family.noUnclaimedAwards")} />
        ) : (
          <View style={styles.list}>
            {summary.unclaimedAwards.map((award) => (
              <View key={award.id} style={styles.awardRow}>
                <Image source={{ uri: toAppAssetUrl("/rewards/screens.png") }} style={styles.awardImage} />
                <View style={styles.awardCopy}>
                  <Text style={styles.cardTitle}>{award.rewardDescription}</Text>
                  <Text style={styles.subtle}>{t("communityAwards.coinAmount", { coins: award.coinCost })}</Text>
                  {summary.canManageAwards ? (
                    <View style={styles.awardAction}>
                      <Button
                        label={claimingAwardId === award.id ? t("family.claiming") : t("family.claim")}
                        disabled={claimingAwardId.length > 0}
                        onPress={() => onClaimAward?.(award.id)}
                      />
                    </View>
                  ) : (
                    <Text style={styles.guardianNote}>{t("profile.awardGuardianAcknowledgement")}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionHeader title={t("family.ownedItems")} />
        <Text style={styles.subtle}>{t("family.ownedItemsSubtitle")}</Text>
        {categoryCounts.length === 0 ? (
          <EmptyState message={t("family.noOwnedItems")} />
        ) : (
          <View style={styles.list}>
            {categoryCounts.map(({ category, count }) => (
              <View key={category} style={styles.categoryRow}>
                <Text style={styles.cardTitle}>{humanizeCategory(category)}</Text>
                <Text style={styles.subtle}>
                  {t("family.itemCount", { count, suffix: count === 1 ? "" : "s" })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm, marginTop: spacing.sm },
  awardRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#f8fafc",
  },
  awardImage: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#e2e8f0" },
  awardCopy: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typography.body, fontWeight: "800", color: colors.text },
  subtle: { fontSize: typography.small, color: colors.muted },
  guardianNote: { marginTop: 4, fontSize: typography.small, color: "#475569" },
  awardAction: { marginTop: spacing.xs, alignSelf: "flex-start" },
  categoryRow: {
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#f8fafc",
  },
});
