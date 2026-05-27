import React, { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "success";
  leadingIcon?: ReactNode;
};

export function Button({ label, onPress, disabled, variant = "primary", leadingIcon }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.danger,
        variant === "success" && styles.success,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {leadingIcon ? <View style={styles.iconSlot}>{leadingIcon}</View> : null}
        <Text style={[styles.text, (variant === "secondary" || variant === "danger") && styles.textDark]}>{label}</Text>
      </View>
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
  success: { backgroundColor: "#16a34a", borderColor: "#15803d", borderWidth: 1 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  iconSlot: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "800", fontSize: typography.body },
  textDark: { color: colors.brandStrong },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.6 },
});
