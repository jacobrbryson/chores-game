import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import {
  loadAchievementsPreferences,
  saveAchievementsPreferences,
} from "@/lib/mobile-preferences";
import { colors, spacing, typography } from "@/theme";
import { useMobileLocale } from "@/lib/locale";
import { MobileAchievementCard, type MobileAchievement } from "@/components/MobileAchievementCard";
import { AppScreen, Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type AudienceFilter = "all" | "player" | "admin";

type AchievementPayload = {
  viewerUid?: string;
  viewerRole?: "admin" | "player";
  achievements?: MobileAchievement[];
  items?: MobileAchievement[];
};

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
};

export function AchievementsScreen({ right, onGoDashboard }: Props) {
  const { t } = useMobileLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<MobileAchievement[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [viewerKey, setViewerKey] = useState("default");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [hideComplete, setHideComplete] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch("/achievements")
      .then((response) => {
        if (!active) {
          return;
        }
        const payload = response as AchievementPayload;
        const nextItems = Array.isArray(payload.achievements)
          ? payload.achievements
          : Array.isArray(payload.items)
            ? payload.items
            : [];
        setItems(nextItems);
        setViewerRole(payload.viewerRole === "admin" ? "admin" : "player");
        const nextViewerKey = typeof payload.viewerUid === "string" && payload.viewerUid ? payload.viewerUid : "default";
        setViewerKey(nextViewerKey);
        void loadAchievementsPreferences(nextViewerKey).then((preferences) => {
          if (!active) {
            return;
          }
          setHideComplete(preferences.hideComplete);
        });
        setError("");
      })
      .catch((loadError: unknown) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "achievements_unavailable");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!viewerKey) {
      return;
    }
    void saveAchievementsPreferences(viewerKey, { hideComplete });
  }, [hideComplete, viewerKey]);

  const orderedItems = useMemo(() => {
    let filtered = [...items];
    if (viewerRole === "player") {
      filtered = filtered.filter((item) => item.audience === "player");
    } else if (audienceFilter !== "all") {
      filtered = filtered.filter((item) => item.audience === audienceFilter);
    }
    if (hideComplete) {
      filtered = filtered.filter((item) => !item.completed);
    }
    return filtered.sort((a, b) => {
      if (b.percentComplete !== a.percentComplete) {
        return b.percentComplete - a.percentComplete;
      }
      if (viewerRole === "player" && a.audience !== b.audience) {
        return a.audience === "player" ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder;
    });
  }, [audienceFilter, hideComplete, items, viewerRole]);

  const totals = useMemo(() => {
    let visibleItems = [...items];
    if (viewerRole === "player") {
      visibleItems = visibleItems.filter((item) => item.audience === "player");
    } else if (audienceFilter !== "all") {
      visibleItems = visibleItems.filter((item) => item.audience === audienceFilter);
    }
    return {
      total: visibleItems.length,
      completed: visibleItems.filter((item) => item.completed).length,
    };
  }, [audienceFilter, items, viewerRole]);

  return (
    <AppScreen
      title={t("nav.achievements")}
      subtitle={t("achievements.subtitle")}
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {loading ? <LoadingState label={t("achievements.loading")} /> : null}
      {error ? <ErrorState message={t("achievements.loadError", { error })} /> : null}
      {!loading && !error ? (
        <>
          {viewerRole === "admin" ? (
            <Card>
              <SectionHeader title={t("achievements.audienceHeading")} />
              <View style={styles.filterRow}>
                {(["all", "player", "admin"] as const).map((value) => (
                  <Button
                    key={value}
                    label={t(`achievements.tabs.${value}`)}
                    variant={audienceFilter === value ? "primary" : "secondary"}
                    onPress={() => setAudienceFilter(value)}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={styles.summaryRow}>
              <View style={styles.summaryBadges}>
                <Badge label={t("achievements.total", { count: totals.total })} />
                <Badge label={t("achievements.completedCount", { count: totals.completed })} tone="success" />
              </View>
              <View style={styles.toggleWrap}>
                <Text style={styles.toggleLabel}>{t("achievements.hideComplete")}</Text>
                <Switch
                  value={hideComplete}
                  onValueChange={setHideComplete}
                  trackColor={{ false: "#cbd5e1", true: "#93c5fd" }}
                  thumbColor={hideComplete ? colors.brand : "#ffffff"}
                />
              </View>
            </View>
          </Card>

          <Card>
            <SectionHeader title={t("achievements.board")} />
            {orderedItems.length === 0 ? (
              <EmptyState message={t("achievements.emptyFiltered")} />
            ) : (
              <View style={styles.list}>
                {orderedItems.map((item) => (
                  <MobileAchievementCard key={item.id} achievement={item} />
                ))}
              </View>
            )}
          </Card>
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryRow: {
    gap: spacing.sm,
  },
  summaryBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  toggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.body,
    fontWeight: "700",
    color: colors.text,
  },
  list: {
    gap: spacing.sm,
  },
});
