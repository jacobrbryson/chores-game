import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, typography } from "@/theme";

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return <View style={styles.row}><Text style={styles.text}>{title}</Text>{right}</View>;
}

const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, text: { fontSize: typography.h3, color: colors.text, fontWeight: "800" } });
