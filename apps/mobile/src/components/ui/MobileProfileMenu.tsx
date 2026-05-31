import React from "react";
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { appBaseUrl, signOut } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type Props = {
  email?: string;
  name?: string;
  avatarUrl?: string;
  coinBalance?: number;
  onOpenProfile?: () => void;
  onLoggedOut?: () => void;
  triggerVariant?: "avatar" | "main-nav";
  triggerLabel?: string;
};

type MenuAction = {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: "default" | "danger";
};

function normalizeWebUrl(path: string) {
  return `${appBaseUrl}${path}`;
}

export function MobileProfileMenu({
  email = "",
  name = "",
  avatarUrl = "",
  coinBalance = 0,
  onOpenProfile,
  onLoggedOut,
  triggerVariant = "avatar",
  triggerLabel = "More",
}: Props) {
  const { t } = useMobileLocale();
  const [open, setOpen] = React.useState(false);
  const [pendingLogout, setPendingLogout] = React.useState(false);
  const initial = (name.trim()[0] || email.trim()[0] || "U").toUpperCase();

  async function openWebPath(path: string) {
    const url = normalizeWebUrl(path);
    setOpen(false);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.assign(url);
      return;
    }
    await Linking.openURL(url);
  }

  const actions: MenuAction[] = [
    { label: t("nav.notifications"), onPress: () => openWebPath("/notifications") },
    {
      label: t("nav.profile"),
      onPress: () => {
        setOpen(false);
        onOpenProfile?.();
      },
    },
    { label: t("nav.manageFamily"), onPress: () => openWebPath("/family") },
    {
      label: pendingLogout ? t("common.actions.loading") : t("nav.logout"),
      tone: "danger",
      onPress: async () => {
        if (pendingLogout) {
          return;
        }
        setPendingLogout(true);
        try {
          await signOut();
          setOpen(false);
          onLoggedOut?.();
        } finally {
          setPendingLogout(false);
        }
      },
    },
  ];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          triggerVariant === "main-nav" && styles.navTrigger,
          pressed && styles.triggerPressed,
        ]}>
        <AvatarBadge
          name={name || email || initial}
          imageUrl={avatarUrl}
          color={colors.brand}
          size={triggerVariant === "main-nav" ? 27 : 36}
        />
        {triggerVariant === "main-nav" ? (
          <View style={styles.coinChip}>
            <Text style={styles.coinIcon}>$</Text>
            <Text style={styles.coinText}>{coinBalance}</Text>
          </View>
        ) : (
          <Text style={styles.navLabel}>{triggerLabel}</Text>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.header}>
              <AvatarBadge name={name || email || initial} imageUrl={avatarUrl} color={colors.brand} size={40} />
              <View style={styles.identity}>
                <Text style={styles.name}>{name || t("profile.signedIn")}</Text>
                <Text style={styles.email}>{email || t("profile.accountFallback")}</Text>
              </View>
            </View>
            <View style={styles.menu}>
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  onPress={() => {
                    void action.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.menuItem,
                    action.tone === "danger" && styles.menuItemDanger,
                    pressed && styles.menuItemPressed,
                  ]}>
                  <Text
                    style={[
                      styles.menuLabel,
                      action.tone === "danger" && styles.menuLabelDanger,
                    ]}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  navTrigger: { width: "100%", height: "100%", borderRadius: 0, gap: 3 },
  triggerPressed: { transform: [{ scale: 0.97 }] },
  navLabel: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800" },
  coinChip: {
    minHeight: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#f3c96c",
    backgroundColor: "#ffe8ad",
    paddingHorizontal: 6,
  },
  coinIcon: { color: "#845205", fontSize: 9, fontWeight: "900" },
  coinText: { color: "#845205", fontSize: typography.tiny, fontWeight: "900" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.28)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 72,
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    width: 232,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  identity: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  email: { color: colors.muted, fontSize: typography.tiny },
  menu: { gap: spacing.xs },
  menuItem: {
    minHeight: 44,
    borderRadius: radius.md,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  menuItemDanger: { backgroundColor: "#fff1f2" },
  menuItemPressed: { backgroundColor: "#eef6ff" },
  menuLabel: { color: colors.text, fontSize: typography.body, fontWeight: "700" },
  menuLabelDanger: { color: "#b91c1c" },
});
