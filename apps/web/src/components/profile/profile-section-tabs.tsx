"use client";

import styles from "./profile-section-tabs.module.css";

export type ProfileSectionTabId = "general" | "inventory" | "notifications" | "integrations";

const PROFILE_TABS: Array<{ id: ProfileSectionTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "inventory", label: "Inventory" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
];

type ProfileSectionTabsProps = {
  activeTab: ProfileSectionTabId;
  onChange: (tabId: ProfileSectionTabId) => void;
};

export function ProfileSectionTabs({ activeTab, onChange }: ProfileSectionTabsProps) {
  return (
    <nav className={styles.tabs} aria-label="Profile sections">
      {PROFILE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
          aria-pressed={activeTab === tab.id}
          onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
