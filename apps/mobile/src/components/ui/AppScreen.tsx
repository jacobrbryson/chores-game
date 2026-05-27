import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/theme";
import { AppBreadcrumbs } from "@/components/ui/AppBreadcrumbs";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPressBreadcrumbRoot?: () => void;
  children: React.ReactNode;
};

export function AppScreen({ title, subtitle, right, onPressBreadcrumbRoot, children }: Props) {
  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <View style={styles.pageBlock}>
            <View style={styles.topRow}>
              <View style={styles.breadcrumbSlot}>
                <AppBreadcrumbs
                  pageLabel={title}
                  subtitle={subtitle}
                  onPressRoot={onPressBreadcrumbRoot}
                />
              </View>
              {right ? <View style={styles.rightSlot}>{right}</View> : null}
            </View>
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
  rightSlot: { flexShrink: 0, alignItems: "flex-end", justifyContent: "center" },
});
