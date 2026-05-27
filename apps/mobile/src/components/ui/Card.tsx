import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { colors, gradients, radius, spacing, shadows } from "@/theme";

type Props = { children: React.ReactNode; style?: StyleProp<ViewStyle> };

export function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: gradients.card[0],
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
});
