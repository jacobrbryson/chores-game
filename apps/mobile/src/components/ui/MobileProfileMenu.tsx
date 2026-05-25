import React from "react";
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { appBaseUrl, signOut } from "@/lib/api";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type Props = {
  email?: string;
  name?: string;
  onOpenProfile?: () => void;
  onLoggedOut?: () => void;
};

type MenuAction = {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: "default" | "danger";
};

function normalizeWebUrl(path: string) {
  return `${appBaseUrl}${path}`;
}

export function MobileProfileMenu({ email = "", name = "", onOpenProfile, onLoggedOut }: Props) {
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
    { label: "Notifications", onPress: () => openWebPath("/notifications") },
    {
      label: "Profile",
      onPress: () => {
        setOpen(false);
        onOpenProfile?.();
      },
    },
    { label: "Manage Family", onPress: () => openWebPath("/family") },
    {
      label: pendingLogout ? "Logging out..." : "Logout",
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
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}>
        <Text style={styles.triggerText}>{initial}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={styles.identity}>
                <Text style={styles.name}>{name || "Signed In"}</Text>
                <Text style={styles.email}>{email || "Family Chores account"}</Text>
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
    backgroundColor: colors.brand,
  },
  triggerPressed: { transform: [{ scale: 0.97 }] },
  triggerText: { color: "#fff", fontSize: typography.small, fontWeight: "800" },
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: typography.body, fontWeight: "800" },
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
