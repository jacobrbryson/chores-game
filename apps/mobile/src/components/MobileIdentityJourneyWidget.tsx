import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  RESPONSIBILITY_PILLAR_EMOJI,
  primaryJourneyPillar,
  responsibilityTitleLabel,
} from "@packages/core";
import { useResponsibilityIdentities } from "@/lib/responsibility-identity";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { ProgressBar } from "@/components/ui";

// Dashboard "Your Journey" widget for players, the mobile counterpart of web's
// IdentityJourneyWidget: features the pillar the child is most invested in,
// showing their current title and how close they are to the next one. Tapping
// opens the profile, where the full Responsibility Progress lives. Renders
// nothing until a pillar has XP, so a brand-new player's dashboard stays clean.
export function MobileIdentityJourneyWidget({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const { t } = useMobileLocale();
  const identities = useResponsibilityIdentities();

  const primary = identities ? primaryJourneyPillar(identities) : null;
  if (!primary) {
    return null;
  }

  const pillarName = t(`responsibility.pillars.${primary.pillar}`);
  const currentTitle = responsibilityTitleLabel(primary.pillar, primary.titleTier, t);
  const nextTitle =
    primary.nextTitleTier !== null
      ? responsibilityTitleLabel(primary.pillar, primary.nextTitleTier, t)
      : "";
  const percent = Math.round(primary.titleProgressFraction * 100);

  return (
    <Pressable
      accessibilityRole={onOpenProfile ? "button" : undefined}
      accessibilityLabel={t("responsibility.identity.journeyTitle")}
      disabled={!onOpenProfile}
      onPress={onOpenProfile}
      style={({ pressed }) => [styles.card, pressed && onOpenProfile ? styles.pressed : null]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t("responsibility.identity.journeyTitle")}</Text>
        <Text style={styles.pillar} numberOfLines={1}>
          {`${RESPONSIBILITY_PILLAR_EMOJI[primary.pillar]} ${pillarName}`}
        </Text>
      </View>
      <Text style={styles.title}>{currentTitle}</Text>
      <Text style={styles.next}>
        {nextTitle
          ? t("responsibility.identity.progressToNext", { percent, title: nextTitle })
          : t("responsibility.identity.topTitle")}
      </Text>
      <ProgressBar value={percent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    padding: spacing.md,
  },
  pressed: { opacity: 0.82 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  eyebrow: {
    color: colors.muted,
    fontSize: typography.tiny,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pillar: { flexShrink: 1, color: colors.brandStrong, fontSize: typography.small, fontWeight: "800" },
  title: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  next: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
});
