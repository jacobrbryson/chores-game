import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { toAppAssetUrl } from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";
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

function formatCompletedDate(value?: string) {
  if (!value) {
    return "Completed";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Completed";
  }
  return `Completed ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function usesNativeSafeImage(url: string) {
  const normalized = url.trim().toLowerCase();
  return Boolean(normalized) && !normalized.endsWith(".svg");
}

function resolveAchievementImageUrl(url: string) {
  const normalized = url.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.toLowerCase().endsWith(".svg")) {
    const rasterName = normalized.split("/").pop()?.replace(/\.svg$/i, ".png") ?? "";
    return rasterName ? toAppAssetUrl(`/api/achievement-images/${rasterName}`) : "";
  }
  return toAppAssetUrl(normalized);
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
  const achievementImageUrl = resolveAchievementImageUrl(achievement.imageUrl);
  const statusLabel = achievement.completed
    ? "Unlocked"
    : achievement.restricted
      ? "Admin Only"
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
              {achievement.audience === "admin" ? "PARENT" : "PLAYER"}
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
          <Text style={styles.completedText}>{formatCompletedDate(achievement.completedAt)}</Text>
        ) : (
          <>
            <ProgressBar value={achievement.percentComplete} />
            <Text style={styles.progressText}>
              {achievement.restricted
                ? "Available to parents and guardians"
                : `${achievement.progress} / ${achievement.target}`}
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
