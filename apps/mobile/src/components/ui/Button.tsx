import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

export function Button({ label, onPress, disabled, variant = "primary" }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.danger,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, variant !== "primary" && styles.textDark]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  secondary: { backgroundColor: colors.accentSoft, borderColor: colors.line, borderWidth: 1 },
  danger: { backgroundColor: "#fee2e2", borderColor: "#fecaca", borderWidth: 1 },
  text: { color: "#fff", fontWeight: "800", fontSize: typography.body },
  textDark: { color: colors.brandStrong },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.6 },
});
