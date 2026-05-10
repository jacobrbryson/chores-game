import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { apiClient } from "@/lib/api";
import { ScreenShell } from "./ScreenShell";

export function ChoresScreen() {
  const [state, setState] = useState<{ loading: boolean; error?: string; items: Array<{ id: string; title: string }> }>({ loading: true, items: [] });

  useEffect(() => {
    apiClient.chores.list()
      .then((res) => setState({ loading: false, items: res.items.map((c) => ({ id: c.id, title: c.title })) }))
      .catch((err: unknown) => setState({ loading: false, error: err instanceof Error ? err.message : "Failed to load chores", items: [] }));
  }, []);

  return (
    <ScreenShell title="Chores" loading={state.loading} error={state.error}>
      {state.items.length === 0 && !state.loading ? <Text>No chores yet.</Text> : null}
      {state.items.map((item) => (
        <View key={item.id} style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <Text style={{ fontSize: 16 }}>{item.title}</Text>
        </View>
      ))}
    </ScreenShell>
  );
}
