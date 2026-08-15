import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  RESPONSIBILITY_PILLAR_EMOJI,
  responsibilityTitleLabel,
  type ResponsibilityPillar,
} from "@packages/core";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { ProgressBar } from "@/components/ui";

// Shape surfaced by the chore complete response (`responsibilityXp.title`) plus
// the XP gained on this completion. Mirrors web's IdentityTitleCelebrationData.
export type MobileIdentityTitleCelebrationData = {
  pillar: ResponsibilityPillar;
  xpBefore?: number;
  xpAfter?: number;
  levelBefore?: number;
  levelAfter?: number;
  tier: number;
  nextTier: number | null;
  prevFraction: number;
  newFraction: number;
  unlocked: boolean;
  xpAwarded: number;
};

// Reads the identity title payload off a chore-complete response, returning null
// when the completion did not move a pillar. Shared by every mobile completion
// surface so they all celebrate identically.
export function readIdentityTitleCelebration(
  response: unknown,
): MobileIdentityTitleCelebrationData | null {
  const payload = response as
    | {
        responsibilityXp?: {
          choreXpAwarded?: number;
          newSkillXpAwarded?: number;
          title?: Omit<MobileIdentityTitleCelebrationData, "xpAwarded">;
        };
        routineProgress?: { completionBonusXpAwarded?: number };
      }
    | null
    | undefined;
  const title = payload?.responsibilityXp?.title;
  if (!title) {
    return null;
  }
  const xpAwarded =
    (payload?.responsibilityXp?.choreXpAwarded ?? 0) +
    (payload?.responsibilityXp?.newSkillXpAwarded ?? 0) +
    (payload?.routineProgress?.completionBonusXpAwarded ?? 0);
  return { ...title, xpAwarded };
}

// How long the celebration stays up. Unlocking a new title earns a longer beat
// than ordinary progress, matching the web timings.
export function identityCelebrationDurationMs(data: MobileIdentityTitleCelebrationData) {
  return data.unlocked ? 5500 : 4000;
}

// Lightweight celebration shown after a chore completion that grew a
// Responsibility Pillar. Two modes:
//  - progress: "🏠 Home Care / Housekeeper / 62% to Chore Master" + a bar that
//    animates from the previous fraction up to the new one, and "+N XP".
//  - unlocked: a larger "New Title Unlocked" treatment.
// The parent owns mount/unmount (and the auto-dismiss timer).
export function MobileIdentityTitleCelebration({
  data,
}: {
  data: MobileIdentityTitleCelebrationData;
}) {
  const { t } = useMobileLocale();
  const [barFraction, setBarFraction] = useState(data.unlocked ? 0 : data.prevFraction);

  useEffect(() => {
    // Move the bar to its new value once mounted so it reads as growth from the
    // previous fraction rather than appearing already filled.
    const timer = setTimeout(() => setBarFraction(data.unlocked ? 1 : data.newFraction), 50);
    return () => clearTimeout(timer);
  }, [data]);

  const currentTitle = data.tier >= 0 ? responsibilityTitleLabel(data.pillar, data.tier, t) : "";
  const nextTitle =
    data.nextTier !== null ? responsibilityTitleLabel(data.pillar, data.nextTier, t) : "";
  const percent = Math.round(barFraction * 100);

  return (
    <View
      accessibilityRole="alert"
      style={[styles.card, data.unlocked ? styles.cardUnlocked : styles.cardProgress]}>
      {data.unlocked ? (
        <Text style={styles.unlockedEyebrow}>{t("responsibility.identity.titleUnlocked")}</Text>
      ) : null}
      <Text style={styles.pillar}>
        {`${RESPONSIBILITY_PILLAR_EMOJI[data.pillar]} ${t(`responsibility.pillars.${data.pillar}`)}`}
      </Text>
      {currentTitle ? (
        <Text style={[styles.title, data.unlocked ? styles.titleUnlocked : null]}>
          {currentTitle}
        </Text>
      ) : null}
      <Text style={styles.level}>
        {t("responsibility.progress.level", { level: data.levelAfter ?? data.levelBefore ?? 1 })}
      </Text>
      <Text style={styles.next}>
        {nextTitle
          ? t("responsibility.identity.progressToNext", { percent, title: nextTitle })
          : t("responsibility.identity.topTitle")}
      </Text>
      <ProgressBar value={percent} />
      {data.xpAwarded > 0 ? (
        <Text style={styles.xp}>{t("responsibility.routines.xpEarned", { xp: data.xpAwarded })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
  },
  cardProgress: { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" },
  cardUnlocked: { borderColor: "#fcd34d", backgroundColor: "#fffbeb" },
  unlockedEyebrow: {
    color: "#b45309",
    fontSize: typography.small,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pillar: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  title: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  titleUnlocked: { fontSize: 26 },
  level: {
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    color: "#ffffff",
    fontSize: typography.tiny,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  next: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  xp: { color: "#047857", fontSize: typography.tiny, fontWeight: "900" },
});
