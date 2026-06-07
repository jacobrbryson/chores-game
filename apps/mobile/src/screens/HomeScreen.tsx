import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppScreen } from "@/components/ui";
import { MobileDashboardChoresPanel } from "@/components/MobileDashboardChoresPanel";
import { MobileFeedPanel } from "@/components/MobileFeedPanel";
import {
  loadDashboardTabPreference,
  saveDashboardTabPreference,
  type DashboardTab,
} from "@/lib/mobile-preferences";
import {
  fetchDiscoverySummary,
  getDiscoverySectionCount,
  markDiscoverySeen,
  type MobileDiscoverySummary,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";

const EMPTY_DISCOVERY: MobileDiscoverySummary = { sections: {}, totalCount: 0 };

function DiscoveryCount({ count }: { count: number }) {
  if (!count || count <= 0) {
    return null;
  }
  const display = count > 99 ? "99+" : String(count);
  return (
    <View style={styles.discoveryBadge} accessibilityLabel={`${count} new`}>
      <Text style={styles.discoveryBadgeText}>{display}</Text>
    </View>
  );
}

type Props = {
  right?: React.ReactNode;
  viewerKey?: string;
  onGoDashboard?: () => void;
  onOpenAllChores?: () => void;
  onOpenStore?: () => void;
};

// Mobile dashboard shell mirrors web: a Chores tab (default) and a Feed tab. The Chores
// tab keeps the existing dashboard chores experience unchanged. Selected tab sticks per
// signed-in viewer.
export function HomeScreen({ right, viewerKey, onOpenAllChores, onOpenStore }: Props) {
  const { t } = useMobileLocale();
  const [tab, setTab] = useState<DashboardTab | null>(null);
  const [discovery, setDiscovery] = useState<MobileDiscoverySummary>(EMPTY_DISCOVERY);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardTabPreference(viewerKey ?? "").then((stored) => {
      if (!cancelled) {
        setTab(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewerKey]);

  const loadDiscovery = React.useCallback(() => {
    void fetchDiscoverySummary()
      .then((summary) => setDiscovery(summary))
      .catch(() => setDiscovery((current) => current));
  }, []);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery, viewerKey]);

  const activeTab = tab ?? "chores";

  // Marking the Chores section seen clears its badge once the Chores tab is the
  // active dashboard tab (not while the panel is merely mounted).
  useEffect(() => {
    if (activeTab === "chores") {
      void markDiscoverySeen(["chores"]).then(loadDiscovery);
    }
  }, [activeTab, loadDiscovery]);

  function selectTab(next: DashboardTab) {
    setTab(next);
    void saveDashboardTabPreference(viewerKey ?? "", next);
  }

  const choresCount = getDiscoverySectionCount(discovery, "chores");
  const whatsNewRows = Object.values(discovery.sections)
    .filter((section) => section.count > 0)
    .sort((a, b) => b.count - a.count);

  function sectionLabel(sectionKey: string): string {
    const map: Record<string, string> = {
      chores: "discovery.sections.chores",
      store: "discovery.sections.store",
      quests: "discovery.sections.quests",
      achievements: "discovery.sections.achievements",
      changelog: "discovery.sections.changelog",
      community_awards: "discovery.sections.communityAwards",
    };
    const key = map[sectionKey];
    return key ? t(key) : sectionKey;
  }

  function navigateForSection(sectionKey: string) {
    void markDiscoverySeen([sectionKey]).then(loadDiscovery);
    if (sectionKey === "store" && onOpenStore) {
      onOpenStore();
    } else if (sectionKey === "chores" && onOpenAllChores) {
      onOpenAllChores();
    }
  }

  return (
    <AppScreen title="Dashboard" right={right}>
      {whatsNewRows.length > 0 ? (
        <View style={styles.whatsNew}>
          <Text style={styles.whatsNewTitle}>{t("discovery.whatsNewTitle")}</Text>
          {whatsNewRows.map((section) => (
            <Pressable
              key={section.sectionKey}
              accessibilityRole="button"
              onPress={() => navigateForSection(section.sectionKey)}
              style={styles.whatsNewRow}
            >
              <Text style={styles.whatsNewLabel}>{sectionLabel(section.sectionKey)}</Text>
              <DiscoveryCount count={section.count} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.tabs}>
        {(["chores", "feed"] as const).map((id) => {
          const active = activeTab === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => selectTab(id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <View style={styles.tabLabelRow}>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {t(`dashboard.tabs.${id}`)}
                </Text>
                {id === "chores" ? <DiscoveryCount count={choresCount} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {/* Render only once the stored tab resolves so we don't flash the wrong panel. */}
      {tab === null ? null : activeTab === "feed" ? (
        <MobileFeedPanel onViewChore={onOpenAllChores} onViewReward={onOpenStore} />
      ) : (
        <MobileDashboardChoresPanel onOpenAllChores={onOpenAllChores} />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.brand, borderWidth: 1, borderColor: colors.brand },
  tabLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabLabel: { fontSize: typography.body, fontWeight: "700", color: colors.muted },
  tabLabelActive: { color: "#ffffff", fontWeight: "800" },
  whatsNew: {
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  whatsNewTitle: { fontSize: typography.body, fontWeight: "800", color: colors.text, marginBottom: 4 },
  whatsNewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  whatsNewLabel: { fontSize: typography.body, fontWeight: "600", color: colors.brandStrong },
  discoveryBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 5,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  discoveryBadgeText: { color: "#ffffff", fontSize: 11, fontWeight: "800" },
});
