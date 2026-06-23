"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { ApprovalInboxCard } from "@/components/approval-inbox-card";
import { FamilyCard } from "@/components/family-card";
import { IdentityJourneyWidget } from "@/components/identity-journey-widget";
import { FamilyFeedPanel } from "@/components/family-feed-panel";
import { ReacceptanceModal } from "@/components/reacceptance-modal";
import { useLocale } from "@/components/locale-provider";
import { usePersistedTab } from "@/lib/hooks/use-persisted-tab";
import { useMarkDiscoverySeen } from "@/lib/hooks/use-discovery";

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

  // Mark chores discovery seen only while the Chores tab is actually active —
  // the hidden-but-mounted chores panel must not clear the badge. The visible
  // count lives on the top-nav Dashboard item (see MainNavigation).
  useMarkDiscoverySeen(["chores"], activeTab === "chores");

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
    { id: "feed", label: t("dashboard.tabs.feed") },
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
      <div className="dashboard-home-tabs">
        <AppTabs
          ariaLabel={t("dashboard.tabs.ariaLabel")}
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
          variant="pills"
        />
      </div>
      {/* Both panels stay mounted; the inactive one is hidden so the existing dashboard
          chores state (filters, charts, realtime subscription) is preserved across tab
          switches instead of remounting. */}
      <div hidden={activeTab !== "feed"}>
        <FamilyFeedPanel />
      </div>
      <div hidden={activeTab !== "chores"}>
        {/* Player "Your Journey" identity widget. Self-hides until a pillar has
            XP; parent dashboard growth details are available from child avatars
            in the chore list. */}
        {onboardingStatus?.viewerRole === "player" ? <IdentityJourneyWidget /> : null}
        <FamilyCard />
      </div>
    </div>
  );
}
