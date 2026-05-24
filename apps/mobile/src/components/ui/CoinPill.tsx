import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

export function CoinPill({ value }: { value: string | number }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.coin}>$</Text>
      <Text style={styles.text}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, backgroundColor: colors.coin, borderWidth: 1, borderColor: "#f59e0b", paddingHorizontal: spacing.sm, paddingVertical: 3 },
  coin: { color: "#92400e", fontWeight: "900", fontSize: typography.small },
  text: { color: "#92400e", fontWeight: "900", fontSize: typography.small },
});
