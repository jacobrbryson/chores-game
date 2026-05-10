import React from "react";
import { SafeAreaView, Text, View, ActivityIndicator } from "react-native";

export function ScreenShell(props: { title: string; loading?: boolean; error?: string; children?: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f4fbff", padding: 16 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", color: "#17406b", marginBottom: 12 }}>{props.title}</Text>
      {props.loading ? <ActivityIndicator size="large" color="#2f80ed" /> : null}
      {props.error ? (
        <View style={{ backgroundColor: "#ffe5e5", borderRadius: 14, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: "#9b1c1c" }}>{props.error}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>{props.children}</View>
    </SafeAreaView>
  );
}
