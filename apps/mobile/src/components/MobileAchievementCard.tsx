import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { resolveAchievementImageUrl, usesNativeSafeImage } from "@/lib/achievement-image";
import { colors, radius, spacing, typography } from "@/theme";
import { useMobileLocale } from "@/lib/locale";
import { Badge, ProgressBar } from "@/components/ui";

export type MobileAchievement = {
  id: string;
  audience: "player" | "admin";
  title: string;
  wittyTitle: string;
  description: string;
  imageUrl: string;
  target: number;
  sortOrder: number;
  progress: number;
  percentComplete: number;
  completed: boolean;
  completedAt?: string;
  locked: boolean;
  restricted: boolean;
};

function formatCompletedDate(
  value: string | undefined,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!value) {
    return t("achievements.completed");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("achievements.completed");
  }
  return t("achievements.completedOn", {
    date: new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date),
  });
}

function buildMonogram(value: string) {
  const parts = value
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "AC";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function MobileAchievementCard({ achievement }: { achievement: MobileAchievement }) {
  const { locale, t } = useMobileLocale();
  const achievementImageUrl = resolveAchievementImageUrl(achievement.imageUrl);
  const statusLabel = achievement.completed
    ? t("achievements.unlocked")
    : achievement.restricted
      ? t("achievements.adminOnly")
      : `${achievement.percentComplete}%`;

  return (
    <View
      style={[
        styles.card,
        achievement.completed && styles.cardCompleted,
        achievement.restricted && styles.cardRestricted,
      ]}>
      <View style={styles.headerRow}>
        {usesNativeSafeImage(achievementImageUrl) ? (
          <Image
            source={{ uri: achievementImageUrl }}
            style={[styles.image, achievement.restricted ? styles.imageRestricted : null]}
          />
        ) : (
          <View
            style={[
              styles.fallbackArt,
              achievement.completed && styles.fallbackArtCompleted,
              achievement.restricted && styles.fallbackArtRestricted,
            ]}>
            <View style={styles.fallbackOrbPrimary} />
            <View style={styles.fallbackOrbSecondary} />
            <Text style={styles.fallbackAudience}>
              {achievement.audience === "admin"
                ? t("achievements.audienceShort.admin")
                : t("achievements.audienceShort.player")}
            </Text>
            <Text style={styles.fallbackMonogram}>{buildMonogram(achievement.wittyTitle || achievement.title)}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.wittyTitle}>{achievement.wittyTitle}</Text>
          <Text style={styles.title}>{achievement.title}</Text>
          <Text style={styles.description}>{achievement.description}</Text>
        </View>
        <Badge
          label={statusLabel}
          tone={achievement.completed ? "success" : achievement.restricted ? "warning" : "default"}
        />
      </View>
      <View style={styles.footer}>
        {achievement.completed ? (
          <Text style={styles.completedText}>
            {formatCompletedDate(achievement.completedAt, locale, t)}
          </Text>
        ) : (
          <>
            <ProgressBar value={achievement.percentComplete} />
            <Text style={styles.progressText}>
              {achievement.restricted
                ? t("achievements.restrictedHint")
                : t("achievements.progressOfTarget", {
                    progress: achievement.progress,
                    target: achievement.target,
                  })}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: spacing.md,
    gap: spacing.md,
  },
  cardCompleted: {
    borderColor: "#86efac",
    backgroundColor: "#f3fff7",
  },
  cardRestricted: {
    backgroundColor: "#f8fafc",
    opacity: 0.88,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  image: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.accentSoft,
  },
  imageRestricted: {
    opacity: 0.5,
  },
  fallbackArt: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#eaf6fc",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  fallbackArtCompleted: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  fallbackArtRestricted: {
    backgroundColor: "#e2e8f0",
  },
  fallbackOrbPrimary: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0, 114, 178, 0.16)",
    top: -6,
    right: -8,
  },
  fallbackOrbSecondary: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(86, 180, 233, 0.22)",
    bottom: -4,
    left: -6,
  },
  fallbackAudience: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: colors.brandStrong,
  },
  fallbackMonogram: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.text,
    marginTop: 2,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  wittyTitle: {
    fontSize: typography.body,
    fontWeight: "800",
    color: colors.text,
  },
  title: {
    fontSize: typography.small,
    fontWeight: "700",
    color: colors.brandStrong,
  },
  description: {
    fontSize: typography.small,
    color: colors.muted,
  },
  footer: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
  },
  progressText: {
    fontSize: typography.tiny,
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
  },
  completedText: {
    fontSize: typography.tiny,
    color: colors.muted,
    textAlign: "center",
    fontWeight: "700",
  },
});
