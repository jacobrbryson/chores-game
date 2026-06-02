"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { useLocale } from "@/components/locale-provider";

export type ProfileSectionTabId =
  | "general"
  | "inventory"
  | "notifications"
  | "integrations"
  | "requests";

type ProfileSectionTabsProps = {
  activeTab: ProfileSectionTabId;
  onChange: (tabId: ProfileSectionTabId) => void;
};

export function ProfileSectionTabs({ activeTab, onChange }: ProfileSectionTabsProps) {
  const { t } = useLocale();
  const tabs: AppTabItem<ProfileSectionTabId>[] = [
    { id: "general", label: t("profile.tabs.general") },
    { id: "inventory", label: t("profile.tabs.inventory") },
    { id: "notifications", label: t("profile.tabs.notifications") },
    { id: "integrations", label: t("profile.tabs.integrations") },
    { id: "requests", label: t("profile.tabs.requests") },
  ];

  return <AppTabs ariaLabel={t("nav.profile")} tabs={tabs} activeTab={activeTab} onChange={onChange} />;
}
