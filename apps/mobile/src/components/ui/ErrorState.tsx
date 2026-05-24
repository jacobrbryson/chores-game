import React from "react";
import { StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { colors, typography } from "@/theme";

export function ErrorState({ message }: { message: string }) {
  return <Card><Text style={styles.text}>{message}</Text></Card>;
}

const styles = StyleSheet.create({ text: { color: colors.danger, fontSize: typography.small, fontWeight: "700" } });
