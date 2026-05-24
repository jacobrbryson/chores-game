import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

export function AvatarBadge({ name }: { name: string }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return <View style={styles.avatar}><Text style={styles.text}>{initial}</Text></View>;
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  text: { color: colors.brandStrong, fontSize: typography.body, fontWeight: "800" },
});
