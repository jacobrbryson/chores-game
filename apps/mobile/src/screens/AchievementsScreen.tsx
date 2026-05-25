import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, Badge, Card, EmptyState, ErrorState, LoadingState, ProgressBar, SectionHeader } from "@/components/ui";

type Achievement = { id?: string; achievementId?: string; title: string; wittyTitle?: string; description?: string; percent?: number; percentComplete?: number; completed?: boolean; restricted?: boolean };

type Props = {
  right?: React.ReactNode;
};

export function AchievementsScreen({ right }: Props) {
  const [state, setState] = useState<{ loading: boolean; error?: string; items: Achievement[] }>({ loading: true, items: [] });

  useEffect(() => {
    apiFetch("/achievements")
      .then((res) => setState({ loading: false, items: Array.isArray(res?.items) ? res.items : [] }))
      .catch((err: unknown) => setState({ loading: false, error: err instanceof Error ? err.message : "achievements_unavailable", items: [] }));
  }, []);

  return (
    <AppScreen title="Achievements" subtitle="Progress and unlocks" right={right}>
      {state.loading ? <LoadingState label="Loading achievements..." /> : null}
      {state.error ? <ErrorState message={`Could not load achievements: ${state.error}`} /> : null}
      {!state.loading && !state.error ? (
        <Card>
          <SectionHeader title="Achievement Board" />
          {state.items.length === 0 ? (
            <EmptyState message="No achievements found yet." />
          ) : (
            <View style={styles.list}>
              {state.items.map((item, i) => {
                const percent = item.percent ?? item.percentComplete ?? 0;
                const completed = Boolean(item.completed);
                return (
                  <View key={item.id ?? item.achievementId ?? String(i)} style={[styles.row, item.restricted && styles.restricted]}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>{item.wittyTitle || item.title}</Text>
                      <Badge label={completed ? "Unlocked" : "Locked"} tone={completed ? "success" : "default"} />
                    </View>
                    <Text style={styles.desc}>{item.description || item.title}</Text>
                    <ProgressBar value={percent} />
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: "#fff", padding: spacing.sm, gap: spacing.sm },
  restricted: { opacity: 0.7 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontSize: typography.body, color: colors.text, fontWeight: "800", flex: 1 },
  desc: { fontSize: typography.small, color: colors.muted },
});
