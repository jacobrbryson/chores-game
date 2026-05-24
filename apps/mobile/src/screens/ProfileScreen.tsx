import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { apiClient, apiFetch } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, AvatarBadge, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type ProfileData = {
  name: string;
  email: string;
  role: string;
  balance: number;
  achievementCount: number;
};

type MeResponse = {
  uid: string;
  memberId?: string;
  name: string;
  email: string;
  role: string;
};

export function ProfileScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; data: ProfileData | null }>({ loading: true, data: null });

  useEffect(() => {
    Promise.all([
      apiClient.auth.me().catch(() => null),
      apiFetch("/achievements").catch(() => ({ items: [] })),
    ])
      .then(([meRaw, achievements]) => {
        const me = meRaw as MeResponse | null;
        const count = Array.isArray(achievements?.items) ? achievements.items.filter((a: any) => a.completed).length : 0;
        if (!me) {
          setState({ loading: false, error: "unauthorized", data: null });
          return;
        }
        setState({
          loading: false,
          data: {
            name: me.name || "Family Member",
            email: me.email || "",
            role: me.role || "player",
            balance: 0,
            achievementCount: count,
          },
        });
      })
      .catch((err: unknown) => {
        setState({ loading: false, error: err instanceof Error ? err.message : "profile_unavailable", data: null });
      });
  }, []);

  return (
    <AppScreen title="Profile" subtitle="Your account">
      {state.loading ? <LoadingState label="Loading profile..." /> : null}
      {state.error ? <ErrorState message={`Could not load profile: ${state.error}`} /> : null}
      {!state.loading && !state.error && state.data ? (
        <>
          <Card>
            <View style={styles.topRow}>
              <AvatarBadge name={state.data.name} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{state.data.name}</Text>
                <Text style={styles.email}>{state.data.email || "No email"}</Text>
              </View>
              <CoinPill value={state.data.balance} />
            </View>
          </Card>

          <Card>
            <SectionHeader title="Details" />
            <Text style={styles.detail}>Role: {state.data.role}</Text>
            <Text style={styles.detail}>Achievements unlocked: {state.data.achievementCount}</Text>
          </Card>

          <Card>
            <SectionHeader title="Family & Inventory" />
            <EmptyState message="Family member profile details and quest item inventory will appear here as mobile APIs are expanded." />
          </Card>
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  email: { fontSize: typography.small, color: colors.muted },
  detail: { fontSize: typography.body, color: colors.text },
});
