"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";

export type ProfileSectionTabId = "general" | "inventory" | "notifications" | "integrations";

const PROFILE_TABS: AppTabItem<ProfileSectionTabId>[] = [
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
  return <AppTabs ariaLabel="Profile sections" tabs={PROFILE_TABS} activeTab={activeTab} onChange={onChange} />;
}
