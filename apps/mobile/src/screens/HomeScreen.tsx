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
import { markDiscoverySeen } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  right?: React.ReactNode;
  viewerKey?: string;
  onGoDashboard?: () => void;
  onOpenAllChores?: () => void;
  onOpenStore?: () => void;
  // Called after the dashboard marks a discovery section seen so the bottom-nav
  // badges (owned by App) refresh.
  onDiscoveryRefresh?: () => void;
};

// Mobile dashboard shell mirrors web: a Chores tab (default) and a Feed tab. The Chores
// tab keeps the existing dashboard chores experience unchanged. Selected tab sticks per
// signed-in viewer. Discovery (What's New) counts are surfaced as red badges on the
// bottom navigation (see MainNavigation), not on the dashboard itself.
export function HomeScreen({
  right,
  viewerKey,
  onOpenAllChores,
  onOpenStore,
  onDiscoveryRefresh,
}: Props) {
  const { t } = useMobileLocale();
  const [tab, setTab] = useState<DashboardTab | null>(null);

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

  const activeTab = tab ?? "chores";

  // Marking the Chores section seen clears its nav badge once the Chores tab is
  // the active dashboard tab (not while the panel is merely mounted).
  useEffect(() => {
    if (activeTab === "chores") {
      void markDiscoverySeen(["chores"]).then(() => onDiscoveryRefresh?.());
    }
  }, [activeTab, onDiscoveryRefresh]);

  function selectTab(next: DashboardTab) {
    setTab(next);
    void saveDashboardTabPreference(viewerKey ?? "", next);
  }

  return (
    <AppScreen title="Dashboard" right={right}>
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
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t(`dashboard.tabs.${id}`)}
              </Text>
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
  tabLabel: { fontSize: typography.body, fontWeight: "700", color: colors.muted },
  tabLabelActive: { color: "#ffffff", fontWeight: "800" },
});
