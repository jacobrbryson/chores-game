import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { apiClient } from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";
import { AchievementsScreen } from "@/screens/AchievementsScreen";
import { ChoresScreen } from "@/screens/ChoresScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { LoginPlaceholderScreen } from "@/screens/LoginPlaceholderScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { QuestsScreen } from "@/screens/QuestsScreen";
import { RewardsScreen } from "@/screens/RewardsScreen";
import { MobileProfileMenu } from "@/components/ui";

type TabKey = "home" | "chores" | "rewards" | "quests" | "achievements" | "profile" | "login";

type SessionMe = {
  uid: string;
  memberId?: string;
  name: string;
  email: string;
  role: string;
};

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "home", label: "Home", icon: "??" },
  { key: "chores", label: "Chores", icon: "?" },
  { key: "rewards", label: "Rewards", icon: "??" },
  { key: "quests", label: "Quests", icon: "??" },
  { key: "achievements", label: "Achievements", icon: "?" },
  { key: "profile", label: "Profile", icon: "??" },
  { key: "login", label: "Login", icon: "??" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("home");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [sessionMe, setSessionMe] = useState<SessionMe | null>(null);

  function refreshSession() {
    let cancelled = false;
    const promise = apiClient.auth
      .me()
      .then((me) => {
        if (cancelled) return;
        setSessionMe(me as SessionMe);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setSessionMe(null);
        setAuthState("unauthenticated");
      });
    return {
      promise,
      cancel() {
        cancelled = true;
      },
    };
  }

  useEffect(() => {
    const sessionRequest = refreshSession();
    return () => {
      sessionRequest.cancel();
    };
  }, []);

  const headerRight = authState === "authenticated" ? (
    <MobileProfileMenu
      name={sessionMe?.name}
      email={sessionMe?.email}
      onOpenProfile={() => setTab("profile")}
      onLoggedOut={() => {
        setSessionMe(null);
        setTab("home");
        setAuthState("unauthenticated");
      }}
    />
  ) : null;

  const screen = useMemo(() => {
    if (authState !== "authenticated") {
      return (
        <LoginPlaceholderScreen
          onSignedIn={() => {
            const sessionRequest = refreshSession();
            void sessionRequest.promise;
          }}
        />
      );
    }
    switch (tab) {
      case "chores": return <ChoresScreen right={headerRight} />;
      case "rewards": return <RewardsScreen right={headerRight} />;
      case "quests": return <QuestsScreen right={headerRight} />;
      case "achievements": return <AchievementsScreen right={headerRight} />;
      case "profile": return <ProfileScreen right={headerRight} />;
      case "login": return <LoginPlaceholderScreen />;
      default: return <HomeScreen right={headerRight} />;
    }
  }, [authState, headerRight, tab]);

  if (authState === "checking") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View style={styles.checkingWrap}>
            <Text style={styles.checkingTitle}>Checking session...</Text>
            <Text style={styles.checkingBody}>Please wait while we verify your Family Chores login.</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <View style={styles.screen}>{screen}</View>
        {authState === "authenticated" ? (
          <View style={styles.tabBar}>
            {tabs.map((item) => {
              const active = tab === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  onPress={() => setTab(item.key)}
                  style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.tabPressed]}
                >
                  <Text style={styles.icon}>{item.icon}</Text>
                  <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1 },
  checkingWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  checkingTitle: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  checkingBody: { fontSize: typography.body, color: colors.muted, textAlign: "center" },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  tab: {
    minHeight: 48,
    flex: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef6ff",
  },
  tabActive: { backgroundColor: colors.brand },
  tabPressed: { transform: [{ scale: 0.98 }] },
  icon: { fontSize: 14, marginBottom: 1 },
  label: { fontSize: typography.tiny, color: colors.brandStrong, fontWeight: "800" },
  labelActive: { color: "#fff" },
});
