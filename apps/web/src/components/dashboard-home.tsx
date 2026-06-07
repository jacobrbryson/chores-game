"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { FamilyCard } from "@/components/family-card";
import { FamilyFeedPanel } from "@/components/family-feed-panel";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { DiscoveryWhatsNewCard } from "@/components/discovery-whats-new-card";
import { useLocale } from "@/components/locale-provider";
import { usePersistedTab } from "@/lib/hooks/use-persisted-tab";
import {
  getSectionCount,
  useDiscoverySummary,
  useMarkDiscoverySeen,
} from "@/lib/hooks/use-discovery";

type DashboardHomeTabId = "chores" | "feed";

const DASHBOARD_HOME_TAB_IDS: readonly DashboardHomeTabId[] = ["chores", "feed"];

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
  const [activeTab, setActiveTab] = usePersistedTab<DashboardHomeTabId>({
    storageKey: `dashboard-home-active-tab:${viewerKey || "default"}`,
    defaultTab: "chores",
    validTabs: DASHBOARD_HOME_TAB_IDS,
    urlParamKey: "tab",
  });

  const { summary } = useDiscoverySummary();
  const choresCount = getSectionCount(summary, "chores");
  // Mark chores discovery seen only while the Chores tab is actually active —
  // the hidden-but-mounted chores panel must not clear the badge.
  useMarkDiscoverySeen(["chores"], activeTab === "chores");

  const tabs: AppTabItem<DashboardHomeTabId>[] = [
    {
      id: "chores",
      label: (
        <span className="dashboard-tab-label">
          {t("dashboard.tabs.chores")}
          <DiscoveryBadge count={choresCount} />
        </span>
      ),
    },
    { id: "feed", label: t("dashboard.tabs.feed") },
  ];

  return (
    <div className="dashboard-home">
      <DiscoveryWhatsNewCard />
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
        <FamilyCard />
      </div>
    </div>
  );
}
