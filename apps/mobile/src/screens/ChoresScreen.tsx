import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiClient } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, Badge, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type ChoreItem = {
  id: string;
  title: string;
  status: string;
  coinValue?: number;
  dueDate?: string;
  recurrenceType?: string;
  requireApproval?: boolean;
  choreType?: string;
};

export function ChoresScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; items: ChoreItem[] }>({ loading: true, items: [] });

  useEffect(() => {
    apiClient.chores
      .list()
      .then((res) => {
        const typed = res as { items?: ChoreItem[] };
        setState({ loading: false, items: typed.items ?? [] });
      })
      .catch((err: unknown) => setState({ loading: false, error: err instanceof Error ? err.message : "Failed to load chores", items: [] }));
  }, []);

  return (
    <AppScreen title="Chores" subtitle="Assignments and completion">
      {state.loading ? <LoadingState label="Loading chores..." /> : null}
      {state.error ? <ErrorState message={`Could not load chores: ${state.error}`} /> : null}

      {!state.loading && !state.error ? (
        <Card>
          <SectionHeader title="All Chores" />
          {state.items.length === 0 ? (
            <EmptyState message="No chores yet." />
          ) : (
            <View style={styles.list}>
              {state.items.map((item) => {
                const statusTone = item.status === "Approved" ? "success" : item.status === "Submitted" ? "warning" : "default";
                return (
                  <View key={item.id} style={styles.cardRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.title}>{item.title}</Text>
                      <View style={styles.metaRow}>
                        <Badge label={item.status === "Open" ? "Open" : item.status} tone={statusTone as any} />
                        {item.requireApproval ? <Badge label="Needs Approval" tone="warning" /> : null}
                        {item.choreType && item.choreType !== "normal" ? <Badge label={item.choreType.replace(/_/g, " ")} /> : null}
                      </View>
                      <Text style={styles.metaText}>
                        {item.dueDate ? `Due ${item.dueDate}` : "No due date"}
                        {item.recurrenceType && item.recurrenceType !== "none" ? ` · ${item.recurrenceType}` : ""}
                      </Text>
                    </View>
                    <View style={styles.rightCol}>
                      <CoinPill value={item.coinValue ?? 0} />
                      {item.status === "Open" ? <Button label="Complete" /> : <Button label="Pending" variant="secondary" disabled />}
                    </View>
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
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: spacing.sm, backgroundColor: "#fff" },
  title: { fontSize: typography.body, color: colors.text, fontWeight: "800" },
  metaRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  metaText: { fontSize: typography.small, color: colors.muted },
  rightCol: { alignItems: "flex-end", gap: spacing.sm },
});
