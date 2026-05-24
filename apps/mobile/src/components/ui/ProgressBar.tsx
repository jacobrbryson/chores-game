import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";

export function ProgressBar({ value }: { value: number }) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return <View style={styles.track}><View style={[styles.fill, { width: width as any }]} /></View>;
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radius.pill, backgroundColor: "#e2e8f0", overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.brand, borderRadius: radius.pill },
});
