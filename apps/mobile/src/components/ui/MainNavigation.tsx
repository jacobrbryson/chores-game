import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  mainNavigationItems,
  type MainNavigationIcon,
  type MainNavigationItemId,
} from "@packages/core/src/main-navigation";
import { useMobileLocale } from "@/lib/locale";
import { MobileProfileMenu } from "@/components/ui/MobileProfileMenu";
import { colors, spacing, typography } from "@/theme";

type Props = {
  activeTab: MainNavigationItemId;
  name?: string;
  email?: string;
  avatarUrl?: string;
  coinBalance?: number;
  role?: "admin" | "player" | string;
  isSwitched?: boolean;
  kioskActive?: boolean;
  authenticatedName?: string;
  currentMemberId?: string;
  // Discovery / What's New unseen counts keyed by nav item id.
  discoveryCounts?: Partial<Record<MainNavigationItemId, number>>;
  onNavigate: (tab: MainNavigationItemId) => void;
  onOpenProfile: () => void;
  onLoggedOut: () => void;
  onAccountChanged?: () => void;
};

function NavDiscoveryBadge({ count }: { count: number }) {
  if (!count || count <= 0) {
    return null;
  }
  const display = count > 99 ? "99+" : String(count);
  return (
    <View style={styles.discoveryBadge} accessibilityLabel={`${count} new`}>
      <Text style={styles.discoveryBadgeText}>{display}</Text>
    </View>
  );
}

function IconView({ icon }: { icon: MainNavigationIcon }) {
  if (icon === "list") {
    return (
      <View style={styles.listIcon}>
        <View style={styles.listIconRow}>
          <View style={styles.listIconCheck}>
            <View style={[styles.listIconCheckStroke, styles.listIconCheckStem]} />
            <View style={[styles.listIconCheckStroke, styles.listIconCheckKick]} />
          </View>
          <View style={styles.listIconLine} />
        </View>
        <View style={styles.listIconRow}>
          <View style={styles.listIconCheck}>
            <View style={[styles.listIconCheckStroke, styles.listIconCheckStem]} />
            <View style={[styles.listIconCheckStroke, styles.listIconCheckKick]} />
          </View>
          <View style={styles.listIconLine} />
        </View>
        <View style={styles.listIconRow}>
          <View style={styles.listIconCheck}>
            <View style={[styles.listIconCheckStroke, styles.listIconCheckStem]} />
            <View style={[styles.listIconCheckStroke, styles.listIconCheckKick]} />
          </View>
          <View style={styles.listIconLine} />
        </View>
      </View>
    );
  }
  if (icon === "coin") {
    return (
      <View style={styles.coinIcon}>
        <Text style={styles.coinIconText}>$</Text>
      </View>
    );
  }
  if (icon === "trophy") {
    return (
      <View style={styles.trophyIcon}>
        <View style={styles.trophyCup} />
        <View style={styles.trophyStem} />
        <View style={styles.trophyBase} />
      </View>
    );
  }
  if (icon === "shield") {
    return (
      <View style={styles.shieldIcon}>
        <Text style={styles.shieldIconText}>Y</Text>
      </View>
    );
  }
  return <View style={styles.iconSlot} />;
}

export function MainNavigation({
  activeTab,
  name,
  email,
  avatarUrl,
  coinBalance = 0,
  role,
  isSwitched,
  kioskActive,
  authenticatedName,
  currentMemberId,
  discoveryCounts,
  onNavigate,
  onOpenProfile,
  onLoggedOut,
  onAccountChanged,
}: Props) {
  const { t } = useMobileLocale();
  return (
    <View style={styles.wrap}>
      {mainNavigationItems.map((item) => {
        if (item.id === "more") {
          return (
            <View key={item.id} style={styles.item}>
              <MobileProfileMenu
                name={name}
                email={email}
                avatarUrl={avatarUrl}
                coinBalance={coinBalance}
                role={role}
                isSwitched={isSwitched}
                kioskActive={kioskActive}
                authenticatedName={authenticatedName}
                currentMemberId={currentMemberId}
                triggerVariant="main-nav"
                triggerLabel={t(`nav.${item.id}` as const)}
                onOpenProfile={onOpenProfile}
                onLoggedOut={onLoggedOut}
                onAccountChanged={onAccountChanged}
              />
            </View>
          );
        }
        const active = activeTab === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onNavigate(item.id)}
            style={({ pressed }) => [
              styles.item,
              active && styles.itemActive,
              pressed && styles.itemPressed,
            ]}>
            <View style={styles.iconWrap}>
              <IconView icon={item.icon} />
              <NavDiscoveryBadge count={discoveryCounts?.[item.id] ?? 0} />
            </View>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {t(`nav.${item.id}` as const)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    width: "100%",
    flexShrink: 0,
    alignItems: "stretch",
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  item: {
    minHeight: 64,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: colors.line,
    paddingHorizontal: 2,
    paddingVertical: spacing.xs,
    gap: 4,
    overflow: "hidden",
  },
  itemActive: { backgroundColor: "#e8f5ff" },
  itemPressed: { opacity: 0.76 },
  iconWrap: { position: "relative" },
  discoveryBadge: {
    position: "absolute",
    top: -8,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
    paddingHorizontal: 4,
    backgroundColor: "#dc2626",
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  discoveryBadgeText: { color: "#ffffff", fontSize: 9, fontWeight: "800" },
  iconSlot: { width: 20, height: 20 },
  listIcon: { width: 20, height: 20, justifyContent: "center", gap: 2 },
  listIconRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  listIconCheck: { width: 6, height: 6, position: "relative" },
  listIconCheckStroke: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#16a34a",
  },
  listIconCheckStem: {
    width: 2,
    height: 3.5,
    left: 1,
    top: 2,
    transform: [{ rotate: "-42deg" }],
  },
  listIconCheckKick: {
    width: 2,
    height: 5.25,
    right: 1,
    top: 0.5,
    transform: [{ rotate: "42deg" }],
  },
  listIconLine: { flex: 1, height: 2, borderRadius: 999, backgroundColor: colors.brandStrong },
  coinIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#b45309",
    backgroundColor: "#fcd34d",
  },
  coinIconText: { color: "#845205", fontSize: 13, fontWeight: "900" },
  trophyIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  trophyCup: {
    width: 16,
    height: 11,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    backgroundColor: "#fcd34d",
    borderWidth: 1,
    borderColor: "#92400e",
  },
  trophyStem: { width: 4, height: 5, backgroundColor: "#92400e" },
  trophyBase: { width: 16, height: 3, borderRadius: 2, backgroundColor: "#92400e" },
  shieldIcon: {
    width: 23,
    height: 24,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderBottomLeftRadius: 11,
    borderBottomRightRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d9f99d",
    borderWidth: 1,
    borderColor: "#3f6212",
  },
  shieldIconText: { color: "#3f6212", fontSize: 11, fontWeight: "900" },
  label: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800", lineHeight: 12 },
  labelActive: { color: colors.text },
});
