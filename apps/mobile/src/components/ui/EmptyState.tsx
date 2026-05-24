import React from "react";
import { StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { typography, colors } from "@/theme";

export function EmptyState({ message }: { message: string }) {
  return <Card><Text style={styles.text}>{message}</Text></Card>;
}

const styles = StyleSheet.create({ text: { color: colors.muted, fontSize: typography.body } });
