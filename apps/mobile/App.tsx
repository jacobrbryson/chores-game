import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { MainNavigationItemId } from "@packages/core/src/main-navigation";
import { apiClient } from "@/lib/api";
import { colors, spacing, typography } from "@/theme";
import { AchievementsScreen } from "@/screens/AchievementsScreen";
import { ChoresScreen } from "@/screens/ChoresScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { LoginPlaceholderScreen } from "@/screens/LoginPlaceholderScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { QuestsScreen } from "@/screens/QuestsScreen";
import { RewardsScreen } from "@/screens/RewardsScreen";
import { MainNavigation } from "@/components/ui";

type TabKey = MainNavigationItemId | "profile" | "login" | "all-chores";

type SessionMe = {
  uid: string;
  memberId?: string;
  name: string;
  email: string;
  role: string;
  picture?: string;
  avatarUrl?: string;
  balance?: number;
};

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [sessionMe, setSessionMe] = useState<SessionMe | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coinBalance, setCoinBalance] = useState(0);

  function refreshSession() {
    let cancelled = false;
    const promise = apiClient.auth
      .me()
      .then(async (me) => {
        if (cancelled) return;
        const nextSession = me as SessionMe;
        setSessionMe(nextSession);
        setAvatarUrl(nextSession.avatarUrl || nextSession.picture || "");
        setCoinBalance(typeof nextSession.balance === "number" ? nextSession.balance : 0);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setSessionMe(null);
        setAvatarUrl("");
        setCoinBalance(0);
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
    const goDashboard = () => setTab("dashboard");
    const refreshSessionState = () => {
      const sessionRequest = refreshSession();
      void sessionRequest.promise;
    };
    switch (tab) {
      case "store": return <RewardsScreen onGoDashboard={goDashboard} onStoreUpdated={refreshSessionState} />;
      case "quests": return <QuestsScreen onGoDashboard={goDashboard} />;
      case "achievements": return <AchievementsScreen onGoDashboard={goDashboard} />;
      case "profile": return <ProfileScreen onGoDashboard={goDashboard} />;
      case "all-chores": return <ChoresScreen onGoDashboard={goDashboard} />;
      case "login": return <LoginPlaceholderScreen />;
      default: return <HomeScreen onOpenAllChores={() => setTab("all-chores")} />;
    }
  }, [authState, tab]);

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
        {authState === "authenticated" ? (
          <MainNavigation
            activeTab={tab === "profile" || tab === "login" ? "more" : tab === "all-chores" ? "dashboard" : tab}
            name={sessionMe?.name}
            email={sessionMe?.email}
            avatarUrl={avatarUrl}
            coinBalance={coinBalance}
            onNavigate={(nextTab) => setTab(nextTab)}
            onOpenProfile={() => setTab("profile")}
            onLoggedOut={() => {
              setSessionMe(null);
              setAvatarUrl("");
              setCoinBalance(0);
              setTab("dashboard");
              setAuthState("unauthenticated");
            }}
          />
        ) : null}
        <View style={styles.screen}>{screen}</View>
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
});
