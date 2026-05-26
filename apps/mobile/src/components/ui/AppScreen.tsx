import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme";
import { AppBreadcrumbs } from "@/components/ui/AppBreadcrumbs";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export function AppScreen({ title, subtitle, right, children }: Props) {
  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <View style={styles.pageBlock}>
            <View style={styles.topRow}>
              <View style={styles.breadcrumbSlot}>
                <AppBreadcrumbs pageLabel={title} />
              </View>
              {right ? <View style={styles.rightSlot}>{right}</View> : null}
            </View>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxxl },
  inner: { paddingHorizontal: spacing.lg, gap: spacing.md },
  pageBlock: { gap: spacing.xs, paddingTop: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  breadcrumbSlot: { flex: 1, minWidth: 0 },
  subtitle: { fontSize: typography.small, color: colors.muted },
  rightSlot: { flexShrink: 0, alignItems: "flex-end", justifyContent: "center" },
});
