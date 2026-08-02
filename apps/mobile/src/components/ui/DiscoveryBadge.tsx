import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMobileLocale } from "@/lib/locale";

type Props = {
  count: number;
  variant?: "inline" | "absolute";
};

export function DiscoveryBadge({ count, variant = "inline" }: Props) {
  const { t } = useMobileLocale();
  if (!count || count <= 0) {
    return null;
  }
  const display = count > 99 ? "99+" : String(count);
  return (
    <View
      style={[styles.badge, variant === "absolute" && styles.absolute]}
      accessibilityRole="text"
      accessibilityLabel={t("discovery.badgeLabel", { count })}>
      <Text style={styles.text}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 5,
    backgroundColor: "#dc2626",
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  absolute: {
    position: "absolute",
    top: -8,
    right: -12,
  },
  text: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
});
