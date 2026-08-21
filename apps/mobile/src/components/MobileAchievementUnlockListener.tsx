import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { resolveAchievementImageUrl, usesNativeSafeImage } from "@/lib/achievement-image";
import { connectFamilySocket, type AchievementUnlockedEvent } from "@/lib/ws";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, shadows, spacing, typography } from "@/theme";

// How long an unlock toast stays up before it dismisses itself. Matches the web
// listener so the same unlock feels the same on either surface.
const TOAST_DURATION_MS = 5000;

type ListenerContext = {
  wsAuthToken: string;
  viewerUid: string;
  familyId: string;
};

type ToastItem = AchievementUnlockedEvent & { toastId: string };

type Props = {
  // Changes whenever the signed-in identity changes (sign-in, Switch To, kiosk
  // player switch) so the listener re-binds to the new viewer.
  sessionKey?: string;
  onOpenAchievements?: () => void;
};

// Mobile counterpart to web's AchievementUnlockListener: subscribes to the
// family socket and pops a toast when the signed-in viewer unlocks an
// achievement. Without this, mobile players unlocked achievements silently and
// only found out by opening the Achievements screen.
export function MobileAchievementUnlockListener({ sessionKey = "", onOpenAchievements }: Props) {
  const { t } = useMobileLocale();
  const [context, setContext] = React.useState<ListenerContext | null>(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = React.useCallback((toastId: string) => {
    const timer = timers.current[toastId];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[toastId];
    }
    setToasts((current) => current.filter((entry) => entry.toastId !== toastId));
  }, []);

  React.useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) {
        clearTimeout(timer);
      }
      timers.current = {};
    },
    [],
  );

  React.useEffect(() => {
    let active = true;
    setToasts([]);
    apiFetch("/achievements?mode=listener")
      .then((response: unknown) => {
        if (!active) {
          return;
        }
        const payload = response as Partial<ListenerContext> | null;
        const wsAuthToken = payload?.wsAuthToken?.trim() ?? "";
        const viewerUid = payload?.viewerUid?.trim() ?? "";
        const familyId = payload?.familyId?.trim() ?? "";
        if (!wsAuthToken || !viewerUid || !familyId) {
          setContext(null);
          return;
        }
        setContext({ wsAuthToken, viewerUid, familyId });
      })
      .catch(() => {
        // A realtime listener is a nice-to-have; never surface bootstrap errors.
      });
    return () => {
      active = false;
    };
  }, [sessionKey]);

  React.useEffect(() => {
    if (!context) {
      return;
    }
    const socket = connectFamilySocket({ authToken: context.wsAuthToken });
    if (!socket) {
      return;
    }

    const onUnlocked = (event: AchievementUnlockedEvent) => {
      if (event.userId !== context.viewerUid || event.familyId !== context.familyId) {
        return;
      }
      const toastId = `${event.achievementId}_${event.completedAt}`;
      setToasts((current) => {
        if (current.some((entry) => entry.achievementId === event.achievementId)) {
          return current;
        }
        timers.current[toastId] = setTimeout(() => {
          delete timers.current[toastId];
          setToasts((entries) => entries.filter((entry) => entry.toastId !== toastId));
        }, TOAST_DURATION_MS);
        return [...current, { ...event, toastId }];
      });
    };

    socket.on("achievement:unlocked", onUnlocked);
    return () => {
      socket.off("achievement:unlocked", onUnlocked);
    };
  }, [context]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {toasts.map((toast) => {
        const imageUrl = resolveAchievementImageUrl(toast.imageUrl);
        return (
          <Pressable
            key={toast.toastId}
            accessibilityRole="button"
            style={styles.toast}
            onPress={() => {
              dismiss(toast.toastId);
              onOpenAchievements?.();
            }}>
            {usesNativeSafeImage(imageUrl) ? (
              <Image source={{ uri: imageUrl }} style={styles.image} />
            ) : (
              <View style={[styles.image, styles.imageFallback]}>
                <Text style={styles.imageFallbackText}>{"\u2605"}</Text>
              </View>
            )}
            <View style={styles.copy}>
              <Text style={styles.eyebrow}>{t("achievements.unlockedNotification")}</Text>
              <Text style={styles.title} numberOfLines={1}>
                {toast.wittyTitle || toast.title}
              </Text>
              <Text style={styles.description} numberOfLines={2}>
                {toast.description}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("achievements.dismissNotification")}
              hitSlop={10}
              style={styles.close}
              onPress={() => dismiss(toast.toastId)}>
              <Text style={styles.closeText}>{"\u00d7"}</Text>
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    gap: spacing.sm,
    zIndex: 50,
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: radius.lg,
    backgroundColor: "#fffbeb",
    padding: spacing.md,
    ...shadows.card,
  },
  image: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.accentSoft,
  },
  imageFallback: { alignItems: "center", justifyContent: "center" },
  imageFallbackText: { color: colors.coin, fontSize: typography.h2 },
  copy: { flex: 1, gap: 2 },
  eyebrow: {
    color: "#b45309",
    fontSize: typography.tiny,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  description: { color: colors.muted, fontSize: typography.small, fontWeight: "600" },
  close: { paddingHorizontal: spacing.xs },
  closeText: { color: colors.muted, fontSize: typography.h3, fontWeight: "900" },
});
