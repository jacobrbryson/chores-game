import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type Reward = { id: string; title: string; coinCost: number; available?: boolean; imageId?: string };

type Props = {
  right?: React.ReactNode;
};

export function RewardsScreen({ right }: Props) {
  const [state, setState] = useState<{ loading: boolean; error?: string; items: Reward[] }>({ loading: true, items: [] });

  useEffect(() => {
    apiFetch("/rewards")
      .then((res) => setState({ loading: false, items: Array.isArray(res?.items) ? res.items : [] }))
      .catch((err: unknown) => setState({ loading: false, error: err instanceof Error ? err.message : "rewards_unavailable", items: [] }));
  }, []);

  return (
    <AppScreen title="Rewards" subtitle="Store and family awards" right={right}>
      {state.loading ? <LoadingState label="Loading rewards..." /> : null}
      {state.error ? <ErrorState message={`Could not load rewards: ${state.error}`} /> : null}
      {!state.loading && !state.error ? (
        <Card>
          <SectionHeader title="Reward Shop" />
          {state.items.length === 0 ? (
            <EmptyState message="No rewards available right now." />
          ) : (
            <View style={styles.grid}>
              {state.items.map((reward) => (
                <View key={reward.id} style={styles.rewardCard}>
                  <View style={styles.image}><Text style={styles.imageText}>Reward</Text></View>
                  <Text style={styles.title}>{reward.title}</Text>
                  <CoinPill value={reward.coinCost} />
                  <Button label={reward.available === false ? "Unavailable" : "Redeem"} disabled={reward.available === false} />
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
  grid: { gap: spacing.sm },
  rewardCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: spacing.sm, gap: spacing.sm, backgroundColor: "#fff" },
  image: { width: "100%", height: 120, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  imageText: { color: colors.brandStrong, fontWeight: "800" },
  title: { fontSize: typography.body, color: colors.text, fontWeight: "800" },
});
