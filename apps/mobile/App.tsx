import React, { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { DEFAULT_LOCALE, type AppLocale } from "@packages/locales";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { MainNavigationItemId } from "@packages/core/src/main-navigation";
import {
  apiClient,
  fetchDiscoverySummary,
  getDiscoverySectionCount,
  markDiscoverySeen,
  resolveMobileAvatarUrl,
  ServerUnreachableError,
  type MobileDiscoverySummary,
} from "@/lib/api";
import { MobileLocaleProvider, useMobileLocale } from "@/lib/locale";
import { colors, spacing, typography } from "@/theme";
import { AchievementsScreen } from "@/screens/AchievementsScreen";
import { ApprovalsScreen } from "@/screens/ApprovalsScreen";
import { ChoresScreen } from "@/screens/ChoresScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { LoginPlaceholderScreen } from "@/screens/LoginPlaceholderScreen";
import { ManageFamilyScreen } from "@/screens/ManageFamilyScreen";
import { MobileKioskScreen } from "@/screens/MobileKioskScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { RewardsScreen } from "@/screens/RewardsScreen";
import { Button, MainNavigation } from "@/components/ui";

type TabKey =
  | MainNavigationItemId
  | "profile"
  | "login"
  | "all-chores"
  | "approvals"
  | "notifications"
  | "manage-family";

const EMPTY_DISCOVERY: MobileDiscoverySummary = { sections: {}, totalCount: 0 };

// Nav item -> discovery section. The Dashboard item carries the Chores count;
// Tapping Store or Achievements marks that section seen on view.
const NAV_DISCOVERY_SECTION: Partial<Record<MainNavigationItemId, string>> = {
  dashboard: "chores",
  store: "store",
  achievements: "achievements",
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
  isSwitched?: boolean;
  kioskActive?: boolean;
  authenticatedName?: string;
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
  const [authState, setAuthState] = useState<
    "checking" | "authenticated" | "unauthenticated" | "unreachable"
  >("checking");
  const [sessionMe, setSessionMe] = useState<SessionMe | null>(null);
  // Set when the dashboard approval card hands off a queue that still needs coin
  // values, so the Approvals screen resumes the Approve All flow on arrival.
  const [approvalsAutoApproveAll, setApprovalsAutoApproveAll] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coinBalance, setCoinBalance] = useState(0);
  const [discovery, setDiscovery] = useState<MobileDiscoverySummary>(EMPTY_DISCOVERY);

  const loadDiscovery = React.useCallback(() => {
    void fetchDiscoverySummary(["chores", "feed", "store", "achievements"])
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
        setAvatarUrl(resolveMobileAvatarUrl(nextSession.avatarUrl || nextSession.picture));
        setCoinBalance(typeof nextSession.balance === "number" ? nextSession.balance : 0);
        setAuthState("authenticated");
      })
      .catch((error) => {
        if (cancelled) return;
        setSessionMe(null);
        onLocaleChange(DEFAULT_LOCALE);
        setAvatarUrl("");
        setCoinBalance(0);
        // A dead connection is not the same as "not signed in" — show a retry
        // screen rather than dropping the user onto the login form, where the
        // sign-in request would just hang against the same unreachable backend.
        setAuthState(error instanceof ServerUnreachableError ? "unreachable" : "unauthenticated");
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

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && authState === "authenticated") {
        loadDiscovery();
      }
    });
    return () => subscription.remove();
  }, [authState, loadDiscovery]);

  const discoveryCounts = useMemo<Partial<Record<MainNavigationItemId, number>>>(
    () => ({
      dashboard: getDiscoverySectionCount(discovery, "chores"),
      store: getDiscoverySectionCount(discovery, "store"),
      achievements: getDiscoverySectionCount(discovery, "achievements"),
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
      case "achievements": return <AchievementsScreen onGoDashboard={goDashboard} />;
      case "profile": return <ProfileScreen onGoDashboard={goDashboard} />;
      case "all-chores": return <ChoresScreen onGoDashboard={goDashboard} />;
      case "approvals": return (
        <ApprovalsScreen
          onGoDashboard={goDashboard}
          autoApproveAll={approvalsAutoApproveAll}
          onApprovalsChanged={loadDiscovery}
        />
      );
      case "notifications": return (
        <NotificationsScreen onGoDashboard={goDashboard} onSeenChanged={loadDiscovery} />
      );
      case "manage-family": return <ManageFamilyScreen onGoDashboard={goDashboard} />;
      case "login": return <LoginPlaceholderScreen />;
      default: return (
        <HomeScreen
          viewerKey={sessionMe?.uid}
          feedUnseenCount={getDiscoverySectionCount(discovery, "feed")}
          onOpenAllChores={() => setTab("all-chores")}
          onOpenApprovals={(options) => {
            setApprovalsAutoApproveAll(Boolean(options?.approveAll));
            setTab("approvals");
          }}
          onOpenProfile={() => setTab("profile")}
          onDiscoveryRefresh={loadDiscovery}
        />
      );
    }
  }, [authState, tab, sessionMe?.uid, discovery, loadDiscovery, approvalsAutoApproveAll]);

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

  if (authState === "unreachable") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View style={styles.checkingWrap}>
            <Text style={styles.checkingTitle}>{t("mobile.serverUnreachableTitle")}</Text>
            <Text style={styles.checkingBody}>{t("mobile.serverUnreachableBody")}</Text>
            <View style={styles.retryButton}>
              <Button
                label={t("mobile.serverUnreachableRetry")}
                onPress={() => {
                  setAuthState("checking");
                  const sessionRequest = refreshSession();
                  void sessionRequest.promise;
                }}
              />
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // While Kiosk Mode is active the session identity is the active player; take
  // over the whole app with a focused shared-tablet screen (no parent tabs),
  // mirroring the web /kiosk page.
  if (authState === "authenticated" && sessionMe?.kioskActive) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <MobileKioskScreen
            activeMemberId={sessionMe.memberId}
            onExited={() => {
              const sessionRequest = refreshSession();
              void sessionRequest.promise.then(() => loadDiscovery());
            }}
            onSwitched={() => {
              const sessionRequest = refreshSession();
              void sessionRequest.promise;
            }}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        {authState === "authenticated" ? (
          <MainNavigation
            activeTab={
              tab === "profile" ||
              tab === "login" ||
              tab === "notifications" ||
              tab === "manage-family"
                ? "more"
                : tab === "all-chores" || tab === "approvals"
                  ? "dashboard"
                  : tab
            }
            name={sessionMe?.name}
            email={sessionMe?.email}
            avatarUrl={avatarUrl}
            coinBalance={coinBalance}
            role={sessionMe?.role}
            isSwitched={sessionMe?.isSwitched}
            kioskActive={sessionMe?.kioskActive}
            authenticatedName={sessionMe?.authenticatedName}
            currentMemberId={sessionMe?.memberId}
            discoveryCounts={discoveryCounts}
            onNavigate={handleNavigate}
            onOpenProfile={() => setTab("profile")}
            onOpenNotifications={() => setTab("notifications")}
            onOpenManageFamily={() => setTab("manage-family")}
            onAccountChanged={() => {
              setTab("dashboard");
              const sessionRequest = refreshSession();
              void sessionRequest.promise.then(() => loadDiscovery());
            }}
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
  retryButton: { marginTop: spacing.md, alignSelf: "stretch" },
});
