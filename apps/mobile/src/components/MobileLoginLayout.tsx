import React from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

const brandIcon = require("../../../web/public/icons/web-app-manifest-512x512.png");

const footerLinks = [
  { label: "Terms of Service", url: "https://family-chores.app/terms-of-service" },
  { label: "Privacy Policy", url: "https://family-chores.app/privacy-policy" },
  { label: "Orcwood Games", url: "https://orcwood.com/" },
] as const;

type Props = {
  googleButton: React.ReactNode;
  error?: string;
  configError?: string;
};

export function MobileLoginLayout({ googleButton, error, configError }: Props) {
  return (
    <View style={styles.screen}>
      <View style={styles.logoSection}>
        <Image source={brandIcon} style={styles.logo} resizeMode="contain" accessibilityLabel="Family Chores" />
        <View style={styles.brandCopy}>
          <Text style={styles.title}>Family Chores</Text>
          <Text style={styles.tagline}>Play. Help. Earn.</Text>
        </View>
      </View>
      <View style={styles.actionSection}>
        {googleButton}
        <Text style={styles.description}>
          Turn everyday chores into a family game. Kids complete tasks, earn coins, and unlock rewards while parents keep the household moving.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {configError ? <Text style={styles.error}>{configError}</Text> : null}
      </View>
      <View style={styles.footer}>
        {footerLinks.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(link.url);
            }}
            style={({ pressed }) => [styles.footerLink, pressed && styles.footerLinkPressed]}
          >
            <Text style={styles.footerLinkText}>{link.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  logoSection: {
    height: "33%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  logo: {
    width: 132,
    height: 132,
    borderRadius: radius.lg,
  },
  brandCopy: {
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    color: colors.brandStrong,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40,
    textAlign: "center",
  },
  tagline: {
    color: colors.text,
    fontSize: typography.h3,
    fontWeight: "900",
    textAlign: "center",
  },
  actionSection: {
    alignItems: "center",
    gap: spacing.md,
  },
  description: {
    maxWidth: 320,
    color: colors.muted,
    fontSize: typography.body,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  error: {
    maxWidth: 320,
    color: "#b91c1c",
    fontSize: typography.small,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  footer: {
    marginTop: "auto",
    paddingBottom: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  footerLink: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  footerLinkPressed: {
    backgroundColor: colors.accentSoft,
  },
  footerLinkText: {
    color: colors.brandStrong,
    fontSize: typography.small,
    fontWeight: "800",
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
