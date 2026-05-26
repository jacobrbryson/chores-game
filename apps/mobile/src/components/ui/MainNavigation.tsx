import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  mainNavigationItems,
  type MainNavigationIcon,
  type MainNavigationItemId,
} from "@packages/core/src/main-navigation";
import { MobileProfileMenu } from "@/components/ui/MobileProfileMenu";
import { colors, spacing, typography } from "@/theme";

type Props = {
  activeTab: MainNavigationItemId;
  name?: string;
  email?: string;
  avatarUrl?: string;
  coinBalance?: number;
  onNavigate: (tab: MainNavigationItemId) => void;
  onOpenProfile: () => void;
  onLoggedOut: () => void;
};

function IconView({ icon }: { icon: MainNavigationIcon }) {
  if (icon === "list") {
    return (
      <View style={styles.listIcon}>
        <View style={styles.listIconLine} />
        <View style={styles.listIconLine} />
        <View style={styles.listIconLine} />
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
        <Text style={styles.shieldIconText}>V</Text>
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
  onNavigate,
  onOpenProfile,
  onLoggedOut,
}: Props) {
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
                triggerVariant="main-nav"
                triggerLabel={item.label}
                onOpenProfile={onOpenProfile}
                onLoggedOut={onLoggedOut}
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
            <IconView icon={item.icon} />
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {item.label}
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
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  item: {
    minHeight: 64,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: colors.line,
    paddingHorizontal: 2,
    paddingVertical: spacing.xs,
  },
  itemActive: { backgroundColor: "#e8f5ff" },
  itemPressed: { opacity: 0.76 },
  iconSlot: { width: 24, height: 24 },
  listIcon: { width: 24, height: 24, justifyContent: "center", gap: 4 },
  listIconLine: { height: 3, borderRadius: 2, backgroundColor: colors.brandStrong },
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
  label: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800" },
  labelActive: { color: colors.text },
});
