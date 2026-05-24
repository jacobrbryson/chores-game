import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { familyChoresBrand } from "@packages/core";
import { colors, spacing, typography } from "@/theme";

type Props = { title: string; subtitle?: string; right?: React.ReactNode };

export function AppHeader({ title, subtitle, right }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <View style={styles.sideSlot} />
        <View style={styles.brandCenter}>
          <Text style={styles.title}>{familyChoresBrand.title}</Text>
          <Text style={styles.tagline}>{familyChoresBrand.tagline}</Text>
        </View>
        <View style={styles.sideSlot}>{right}</View>
      </View>
      <View style={styles.pageBlock}>
        <Text style={styles.page}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  brandRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideSlot: {
    minWidth: 56,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  brandCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typography.small, color: colors.brandStrong, fontWeight: "800", textTransform: "uppercase" },
  tagline: { fontSize: typography.tiny, color: colors.muted, fontWeight: "700" },
  pageBlock: { alignItems: "flex-start" },
  page: { fontSize: typography.title, color: colors.text, fontWeight: "800" },
  subtitle: { marginTop: 2, fontSize: typography.small, color: colors.muted },
});
