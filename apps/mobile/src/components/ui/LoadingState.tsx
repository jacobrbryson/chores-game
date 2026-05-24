import React from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { colors, typography } from "@/theme";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <Card><ActivityIndicator color={colors.brand} /><Text style={styles.text}>{label}</Text></Card>;
}

const styles = StyleSheet.create({ text: { color: colors.muted, fontSize: typography.small } });
