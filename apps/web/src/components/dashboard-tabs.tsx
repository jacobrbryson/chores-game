"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CoinIcon } from "@/components/coin-icon";
import styles from "./dashboard-tabs.module.css";

type DashboardTabsProps = {
  visible: boolean;
};

type DashboardTab = {
  id: "chores" | "store" | "achievements" | "quests";
  label: string;
  href?: string;
  disabled?: boolean;
  tooltip?: string;
  icon: ReactNode;
};

const DASHBOARD_TABS: DashboardTab[] = [
  {
    id: "chores",
    label: "Chores",
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
    id: "store",
    label: "Store",
    href: "/store",
    icon: <CoinIcon size={20} className={styles.storeCoin} />,
  },
  {
    id: "achievements",
    label: "Achievements",
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
    label: "Quests",
    disabled: true,
    tooltip: "Coming Soon",
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
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardTabs({ visible }: DashboardTabsProps) {
  const pathname = usePathname();

  if (!visible) {
    return null;
  }

  return (
    <nav className={styles.tabs} aria-label="Dashboard sections">
      {DASHBOARD_TABS.map((tab) => {
        if (tab.disabled) {
          return (
            <span
              key={tab.id}
              className={`${styles.tab} ${styles.tabDisabled}`}
              aria-disabled="true"
              title={tab.tooltip}>
              <span className={styles.icon}>{tab.icon}</span>
              <span className={styles.label}>{tab.label}</span>
            </span>
          );
        }

        const href = tab.href || "/";
        const active = isActiveRoute(pathname, href);

        if (active) {
          return (
            <span key={tab.id} className={`${styles.tab} ${styles.tabActive}`} aria-current="page">
              <span className={styles.icon}>{tab.icon}</span>
              <span className={styles.label}>{tab.label}</span>
            </span>
          );
        }

        return (
          <Link key={tab.id} href={href} className={styles.tab}>
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
