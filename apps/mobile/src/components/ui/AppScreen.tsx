import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme";

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
            <Text style={styles.page}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {right ? <View style={styles.rightSlot}>{right}</View> : null}
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
  pageBlock: { gap: 2, paddingTop: spacing.md },
  page: { fontSize: typography.title, color: colors.text, fontWeight: "800" },
  subtitle: { fontSize: typography.small, color: colors.muted },
  rightSlot: { position: "absolute", right: 0, top: spacing.md },
});
