import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { AppHeader } from "./AppHeader";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export function AppScreen({ title, subtitle, right, children }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader title={title} subtitle={subtitle} right={right} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxxl },
  inner: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
