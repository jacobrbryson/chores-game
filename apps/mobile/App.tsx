import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DEFAULT_LOCALE, type AppLocale } from "@packages/locales";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { MainNavigationItemId } from "@packages/core/src/main-navigation";
import {
  apiClient,
  fetchDiscoverySummary,
  getDiscoverySectionCount,
  markDiscoverySeen,
  type MobileDiscoverySummary,
} from "@/lib/api";
import { MobileLocaleProvider, useMobileLocale } from "@/lib/locale";
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

const EMPTY_DISCOVERY: MobileDiscoverySummary = { sections: {}, totalCount: 0 };

// Nav item -> discovery section. The Dashboard item carries the Chores count;
// tapping Store/Achievements/Quests marks that section seen on view.
const NAV_DISCOVERY_SECTION: Partial<Record<MainNavigationItemId, string>> = {
  dashboard: "chores",
  store: "store",
  achievements: "achievements",
  quests: "quests",
};

type SessionMe = {
  uid: string;
  memberId?: string;
  name: string;
  email: string;
  role: string;
  locale?: AppLocale;
  resolvedLocale?: AppLocale;
  picture?: string;
  avatarUrl?: string;
  balance?: number;
};

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE);

  return (
    <MobileLocaleProvider initialLocale={locale}>
      <AppContent onLocaleChange={setLocale} />
    </MobileLocaleProvider>
  );
}

function AppContent({
  onLocaleChange,
}: {
  onLocaleChange: (locale: AppLocale) => void;
}) {
  const { t } = useMobileLocale();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [sessionMe, setSessionMe] = useState<SessionMe | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coinBalance, setCoinBalance] = useState(0);
  const [discovery, setDiscovery] = useState<MobileDiscoverySummary>(EMPTY_DISCOVERY);

  const loadDiscovery = React.useCallback(() => {
    void fetchDiscoverySummary()
      .then((summary) => setDiscovery(summary))
      .catch(() => setDiscovery((current) => current));
  }, []);

  function refreshSession() {
    let cancelled = false;
    const promise = apiClient.auth
      .me()
      .then(async (me) => {
        if (cancelled) return;
        const nextSession = me as SessionMe;
        setSessionMe(nextSession);
        onLocaleChange(nextSession.resolvedLocale || nextSession.locale || DEFAULT_LOCALE);
        setAvatarUrl(nextSession.avatarUrl || nextSession.picture || "");
        setCoinBalance(typeof nextSession.balance === "number" ? nextSession.balance : 0);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setSessionMe(null);
        onLocaleChange(DEFAULT_LOCALE);
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

  useEffect(() => {
    if (authState === "authenticated") {
      loadDiscovery();
    } else {
      setDiscovery(EMPTY_DISCOVERY);
    }
  }, [authState, loadDiscovery]);

  const discoveryCounts = useMemo<Partial<Record<MainNavigationItemId, number>>>(
    () => ({
      dashboard: getDiscoverySectionCount(discovery, "chores"),
      store: getDiscoverySectionCount(discovery, "store"),
      achievements: getDiscoverySectionCount(discovery, "achievements"),
      quests: getDiscoverySectionCount(discovery, "quests"),
    }),
    [discovery],
  );

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
      default: return (
        <HomeScreen
          viewerKey={sessionMe?.uid}
          onOpenAllChores={() => setTab("all-chores")}
          onOpenStore={() => setTab("store")}
          onDiscoveryRefresh={loadDiscovery}
        />
      );
    }
  }, [authState, tab, sessionMe?.uid, loadDiscovery]);

  // Tapping a nav destination counts as viewing it: mark that section seen and
  // refresh the badges. Chores is handled on the Home dashboard itself.
  const handleNavigate = React.useCallback(
    (nextTab: MainNavigationItemId) => {
      setTab(nextTab);
      const section = NAV_DISCOVERY_SECTION[nextTab];
      if (section && section !== "chores") {
        void markDiscoverySeen([section]).then(loadDiscovery);
      }
    },
    [loadDiscovery],
  );

  if (authState === "checking") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View style={styles.checkingWrap}>
            <Text style={styles.checkingTitle}>{t("mobile.checkingSessionTitle")}</Text>
            <Text style={styles.checkingBody}>{t("mobile.checkingSessionBody")}</Text>
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
            discoveryCounts={discoveryCounts}
            onNavigate={handleNavigate}
            onOpenProfile={() => setTab("profile")}
            onLoggedOut={() => {
              setSessionMe(null);
              onLocaleChange(DEFAULT_LOCALE);
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
