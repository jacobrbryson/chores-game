import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, Badge, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type HomeData = {
  chores: Array<{ id: string; title: string; status: string; coinValue?: number }>;
  balance: number;
};

type Props = {
  right?: React.ReactNode;
};

export function HomeScreen({ right }: Props) {
  const [state, setState] = useState<{ loading: boolean; error?: string; data: HomeData }>({
    loading: true,
    data: { chores: [], balance: 0 },
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/chores").catch(() => ({ items: [] })),
      apiFetch("/rewards").catch(() => ({ items: [] })),
    ])
      .then(([chores]) => {
        if (cancelled) return;
        const items = Array.isArray(chores?.items) ? chores.items : [];
        const open = items.filter((c: any) => c.status === "Open");
        setState({ loading: false, data: { chores: open.slice(0, 4), balance: 0 } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ loading: false, error: err instanceof Error ? err.message : "home_load_failed", data: { chores: [], balance: 0 } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choreCount = state.data.chores.length;
  const greeting = useMemo(() => (choreCount > 0 ? `You have ${choreCount} chores ready.` : "You're all caught up for now."), [choreCount]);

  return (
    <AppScreen title="Home" subtitle="Your family dashboard" right={right}>
      <Card>
        <SectionHeader title="Today" right={<CoinPill value={state.data.balance} />} />
        <Text style={styles.greeting}>{greeting}</Text>
        <View style={styles.quickActions}>
          <Button label="Open Chores" variant="secondary" />
          <Button label="Open Quests" variant="secondary" />
        </View>
      </Card>

      {state.loading ? <LoadingState label="Loading dashboard..." /> : null}
      {state.error ? <ErrorState message={`Could not load home: ${state.error}`} /> : null}

      {!state.loading && !state.error ? (
        <>
          <Card>
            <SectionHeader title="Today's Chores" />
            {state.data.chores.length === 0 ? (
              <EmptyState message="No open chores right now." />
            ) : (
              <View style={styles.list}>
                {state.data.chores.map((chore) => (
                  <View key={chore.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{chore.title}</Text>
                      <Badge label={chore.status === "Open" ? "Ready" : chore.status} />
                    </View>
                    <CoinPill value={chore.coinValue ?? 0} />
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card style={styles.questCard}>
            <SectionHeader title="Quest Spotlight" />
            <Text style={styles.questText}>Continue your story quests and unlock new endings.</Text>
            <Button label="View Quests" />
          </Card>

          <Card>
            <SectionHeader title="Achievements" />
            <Text style={styles.muted}>Track progress and celebrate unlocks with your family.</Text>
          </Card>
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  greeting: { color: colors.muted, fontSize: typography.body },
  quickActions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: "#fff" },
  title: { color: colors.text, fontSize: typography.body, fontWeight: "700", marginBottom: 4 },
  questCard: { backgroundColor: colors.questDark, borderColor: "#334155" },
  questText: { color: "#dbeafe", fontSize: typography.body },
  muted: { color: colors.muted, fontSize: typography.body },
});
