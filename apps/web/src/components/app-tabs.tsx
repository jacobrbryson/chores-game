"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "@/components/app-tabs.module.css";

export type AppTabItem<T extends string = string> = {
  id: T;
  label: string;
  href?: string;
  icon?: ReactNode;
  disabled?: boolean;
  tooltip?: string;
};

type AppTabsProps<T extends string = string> = {
  ariaLabel: string;
  tabs: AppTabItem<T>[];
  activeTab: T;
  onChange?: (tabId: T) => void;
  hideLabelsOnMobile?: boolean;
  variant?: "tabs" | "pills";
};

function joinClasses(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function AppTabs<T extends string>({
  ariaLabel,
  tabs,
  activeTab,
  onChange,
  hideLabelsOnMobile,
  variant = "tabs",
}: AppTabsProps<T>) {
  return (
    <nav
      className={joinClasses(
        styles.tabs,
        variant === "pills" && styles.tabsPills,
        hideLabelsOnMobile && styles.hideLabelsOnMobile,
      )}
      aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        const content = (
          <>
            {tab.icon ? <span className={styles.tabIcon}>{tab.icon}</span> : null}
            <span className={styles.tabLabel}>{tab.label}</span>
          </>
        );
        const className = joinClasses(
          styles.tab,
          active && styles.tabActive,
          tab.disabled && styles.tabDisabled,
        );

        if (tab.disabled) {
          return (
            <span key={tab.id} className={className} aria-disabled="true" title={tab.tooltip}>
              {content}
            </span>
          );
        }

        if (tab.href) {
          return active ? (
            <span key={tab.id} className={className} aria-current="page">
              {content}
            </span>
          ) : (
            <Link key={tab.id} href={tab.href} className={className} title={tab.tooltip}>
              {content}
            </Link>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            className={className}
            aria-pressed={active}
            title={tab.tooltip}
            onClick={() => onChange?.(tab.id)}>
            {content}
          </button>
        );
      })}
    </nav>
  );
}
