"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { ApprovalInboxCard } from "@/components/approval-inbox-card";
import { FamilyCard } from "@/components/family-card";
import { IdentityJourneyWidget } from "@/components/identity-journey-widget";
import { FamilyFeedPanel } from "@/components/family-feed-panel";
import { FamilyFriendsHighlights } from "@/components/family-friends-highlights";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { ReacceptanceModal } from "@/components/reacceptance-modal";
import { useLocale } from "@/components/locale-provider";
import { usePersistedTab } from "@/lib/hooks/use-persisted-tab";
import {
  getSectionCount,
  markDiscoverySeen,
  useDiscoverySummary,
  useMarkDiscoverySeen,
} from "@/lib/hooks/use-discovery";

type DashboardHomeTabId = "chores" | "feed";

const DASHBOARD_HOME_TAB_IDS: readonly DashboardHomeTabId[] = ["chores", "feed"];

type OnboardingStatus = {
  viewerRole: "admin" | "player";
  needsOnboarding: boolean;
  needsReacceptance: boolean;
  hasPreviousVersionedConsent: boolean;
  currentTermsVersion: string;
  currentPrivacyVersion: string;
};

type DashboardHomeProps = {
  // Identifies the signed-in viewer so the selected tab sticks per viewer (e.g. switched
  // managed-child profiles each restore their own last tab).
  viewerKey?: string;
};

// Signed-in dashboard shell. The Chores tab is first and selected by default and wraps
// the existing dashboard chores experience (FamilyCard) unchanged; the Feed tab shows
// the family activity feed. The logged-out homepage never renders this shell (see
// app/page.tsx).
export function DashboardHome({ viewerKey }: DashboardHomeProps) {
  const { t } = useLocale();
  const router = useRouter();
  const [activeTab, setActiveTab] = usePersistedTab<DashboardHomeTabId>({
    storageKey: `dashboard-home-active-tab:${viewerKey || "default"}`,
    defaultTab: "chores",
    validTabs: DASHBOARD_HOME_TAB_IDS,
    urlParamKey: "tab",
  });
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [reacceptanceDone, setReacceptanceDone] = useState(false);
  // Tabs whose panel has been opened at least once this session. A panel mounts
  // the first time its tab becomes active and then stays mounted (see the render
  // block below), so the inactive tab costs nothing on first load but tab
  // switching still preserves state.
  const [activatedTabs, setActivatedTabs] = useState<Set<DashboardHomeTabId>>(
    () => new Set([activeTab]),
  );
  useEffect(() => {
    setActivatedTabs((previous) => {
      if (previous.has(activeTab)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);
  const { summary: discoverySummary } = useDiscoverySummary(["feed"]);
  const feedUnseenCount = getSectionCount(discoverySummary, "feed");

  // Mark chores discovery seen only while the Chores tab is actually active —
  // the hidden-but-mounted chores panel must not clear the badge. The visible
  // count lives on the top-nav Dashboard item (see MainNavigation).
  useMarkDiscoverySeen(["chores"], activeTab === "chores");
  useMarkDiscoverySeen(["feed"], activeTab === "feed");

  // Activity received while the Feed is already visible is seen immediately;
  // FamilyFeedPanel refreshes from the same event.
  useEffect(() => {
    if (activeTab !== "feed" || typeof window === "undefined") {
      return;
    }
    const handleVisibleFeedActivity = () => void markDiscoverySeen(["feed"]);
    window.addEventListener("notifications:refresh", handleVisibleFeedActivity);
    return () => window.removeEventListener("notifications:refresh", handleVisibleFeedActivity);
  }, [activeTab]);

  // Gate check: redirect to onboarding if needed, or surface the re-acceptance
  // modal when the family's consent is outdated. Fails open so the dashboard is
  // never permanently blocked by a transient API error.
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/family/onboarding-status", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as OnboardingStatus;
        if (payload.needsOnboarding && payload.viewerRole === "admin") {
          router.push("/onboarding");
          return;
        }
        setOnboardingStatus(payload);
      } catch {
        // Fail open — don't block the dashboard on network errors.
      }
    })();
  }, [router]);

  const tabs: AppTabItem<DashboardHomeTabId>[] = [
    { id: "chores", label: t("dashboard.tabs.chores") },
    {
      id: "feed",
      label: (
        <>
          {t("dashboard.tabs.feed")}
          <DiscoveryBadge count={feedUnseenCount} />
        </>
      ),
    },
  ];

  const showReacceptance =
    !reacceptanceDone &&
    onboardingStatus?.viewerRole === "admin" &&
    onboardingStatus?.needsReacceptance === true;

  return (
    <div className="dashboard-home">
      {showReacceptance && onboardingStatus ? (
        <ReacceptanceModal
          open
          isFirstAcceptance={!onboardingStatus.hasPreviousVersionedConsent}
          currentTermsVersion={onboardingStatus.currentTermsVersion}
          currentPrivacyVersion={onboardingStatus.currentPrivacyVersion}
          onAccepted={() => setReacceptanceDone(true)}
        />
      ) : null}
      {/* Approval Inbox card sits above the tabs so pending approvals are the first
          thing a parent sees. The card self-gates to admins and renders nothing for
          children. */}
      <ApprovalInboxCard />
      <FamilyFriendsHighlights />
      <div className="dashboard-home-tabs">
        <AppTabs
          ariaLabel={t("dashboard.tabs.ariaLabel")}
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>
      {/* A panel mounts the first time its tab is opened and stays mounted after
          that, so the existing chores state (filters, charts, realtime
          subscription) is still preserved across tab switches.
          Previously both panels mounted immediately, which meant the unopened tab
          fetched its data on every dashboard load: the Feed tab alone contributed
          /api/feed and a /api/discovery/summary call — the two slowest requests in
          the load (6891ms and 6868ms in production) — for a panel the viewer may
          never look at. */}
      <div hidden={activeTab !== "feed"}>
        {activatedTabs.has("feed") ? <FamilyFeedPanel /> : null}
      </div>
      <div hidden={activeTab !== "chores"}>
        {activatedTabs.has("chores") ? (
          <>
            {/* Player "Your Journey" identity widget. Self-hides until a pillar has
                XP; parent dashboard growth details are available from child avatars
                in the chore list. */}
            {onboardingStatus?.viewerRole === "player" ? <IdentityJourneyWidget /> : null}
            <FamilyCard />
          </>
        ) : null}
      </div>
    </div>
  );
}
