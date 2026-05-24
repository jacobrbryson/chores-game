import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, Badge, Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type Quest = { questId: string; title: string; subtitle?: string; completionStatus?: string; actionLabel?: string };

export function QuestsScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; items: Quest[] }>({ loading: true, items: [] });

  useEffect(() => {
    apiFetch("/quests")
      .then((res) => setState({ loading: false, items: Array.isArray(res?.items) ? res.items : [] }))
      .catch((err: unknown) => setState({ loading: false, error: err instanceof Error ? err.message : "quests_unavailable", items: [] }));
  }, []);

  return (
    <AppScreen title="Quests" subtitle="Story adventures">
      {state.loading ? <LoadingState label="Loading quests..." /> : null}
      {state.error ? <ErrorState message={`Could not load quests: ${state.error}`} /> : null}
      {!state.loading && !state.error ? (
        <Card style={styles.darkCard}>
          <SectionHeader title="Quest Library" />
          {state.items.length === 0 ? (
            <EmptyState message="No quests available yet." />
          ) : (
            <View style={styles.list}>
              {state.items.map((quest) => (
                <View key={quest.questId} style={styles.questCard}>
                  <Text style={styles.title}>{quest.title}</Text>
                  {quest.subtitle ? <Text style={styles.desc}>{quest.subtitle}</Text> : null}
                  <View style={styles.row}>
                    <Badge label={(quest.completionStatus ?? "not_started").replaceAll("_", " ")} />
                    <Button label={quest.actionLabel ?? "Start"} />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  darkCard: { backgroundColor: colors.questDark, borderColor: "#334155" },
  list: { gap: spacing.sm },
  questCard: { borderWidth: 1, borderColor: "#334155", borderRadius: 12, padding: spacing.sm, backgroundColor: "#0f172a", gap: spacing.sm },
  title: { fontSize: typography.body, fontWeight: "800", color: "#f8fafc" },
  desc: { fontSize: typography.small, color: "#94a3b8" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
});
