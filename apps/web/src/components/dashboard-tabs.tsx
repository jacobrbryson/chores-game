"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";

type DashboardTabsProps = {
  visible: boolean;
};

type DashboardTabId = "chores" | "routines" | "store" | "achievements" | "quests";
type DashboardTab = AppTabItem<DashboardTabId> & { icon: ReactNode };

function useDashboardTabs() {
  const { t } = useLocale();

  return useMemo<DashboardTab[]>(() => [
    {
      id: "chores",
      label: t("dashboard.tabs.chores"),
      href: "/",
      icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4.75 5.5h14.5M4.75 12h14.5M4.75 18.5h14.5"
          fill="none"
          stroke="#1d4ed8"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M6.75 5.5l1.2 1.2 2.05-2.1M6.75 12l1.2 1.2 2.05-2.1M6.75 18.5l1.2 1.2 2.05-2.1"
          fill="none"
          stroke="#16a34a"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
      ),
    },
    {
      id: "routines",
      label: t("dashboard.tabs.routines"),
      href: "/routines",
      icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 4.75h10a1.5 1.5 0 0 1 1.5 1.5v11.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6.25A1.5 1.5 0 0 1 7 4.75Z"
          fill="#bbf7d0"
          stroke="#15803d"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M8.5 9h7M8.5 12h7M8.5 15h4.5"
          fill="none"
          stroke="#15803d"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
      ),
    },
    {
      id: "store",
      label: t("dashboard.tabs.store"),
      href: "/store",
      icon: <CoinIcon size={20} className="dashboard-store-coin" />,
    },
    {
      id: "achievements",
      label: t("dashboard.tabs.achievements"),
      href: "/achievements",
      icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8 5.25h8v3a4 4 0 1 1-8 0v-3Z"
          fill="#fcd34d"
          stroke="#b45309"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M4.5 6.25h3.5v2a3 3 0 0 1-3.5-3v1Zm15 0H16v2a3 3 0 0 0 3.5-3v1Z"
          fill="none"
          stroke="#92400e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path d="M12 12.5v3.25M9.5 18.5h5" fill="none" stroke="#92400e" strokeLinecap="round" strokeWidth="1.8" />
        <circle cx="12" cy="15.75" r="1.15" fill="#f59e0b" />
      </svg>
      ),
    },
    {
      id: "quests",
      label: t("dashboard.tabs.quests"),
      href: "/quests",
      icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.75 5.25 6.8v5.1c0 3.95 2.7 7.35 6.75 8.35 4.05-1 6.75-4.4 6.75-8.35V6.8L12 3.75Z"
          fill="#fcd34d"
          stroke="#92400e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M9.1 8.25 12 11.15l2.9-2.9M12 11.2v5.2M10 14.35h4"
          fill="none"
          stroke="#92400e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <circle cx="12" cy="11.15" r="1.05" fill="#f59e0b" />
      </svg>
      ),
    },
  ], [t]);
}

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardTabs({ visible }: DashboardTabsProps) {
  const pathname = usePathname();
  const tabs = useDashboardTabs();

  if (!visible) {
    return null;
  }

  const activeTab = tabs.find((tab) => isActiveRoute(pathname, tab.href || "/"))?.id ?? "chores";

  return (
    <div className="dashboard-nav">
      <div className="dashboard-nav-desktop">
        <AppTabs
          ariaLabel={tabs.map((tab) => tab.label).join(", ")}
          tabs={tabs}
          activeTab={activeTab}
          variant="pills"
        />
      </div>
      <div className="dashboard-nav-mobile">
        <AppTabs
          ariaLabel={tabs.map((tab) => tab.label).join(", ")}
          tabs={tabs}
          activeTab={activeTab}
          variant="pills"
          hideLabelsOnMobile
        />
      </div>
    </div>
  );
}
