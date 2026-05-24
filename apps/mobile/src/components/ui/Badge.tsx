import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type Props = { label: string; tone?: "default" | "success" | "warning" | "danger" };

export function Badge({ label, tone = "default" }: Props) {
  return <View style={[styles.badge, tone === "success" && styles.success, tone === "warning" && styles.warn, tone === "danger" && styles.danger]}><Text style={styles.text}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.line },
  success: { backgroundColor: "#dcfce7", borderColor: "#86efac" },
  warn: { backgroundColor: "#fef3c7", borderColor: "#fcd34d" },
  danger: { backgroundColor: "#fee2e2", borderColor: "#fecaca" },
  text: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800", textTransform: "uppercase" },
});
