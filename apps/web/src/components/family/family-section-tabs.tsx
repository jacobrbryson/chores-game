"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { useLocale } from "@/components/locale-provider";

export type FamilySectionTabId =
  | "members"
  | "awards"
  | "categories"
  | "quests"
  | "privacy";

type FamilySectionTabsProps = {
  activeTab: FamilySectionTabId;
  onChange: (tabId: FamilySectionTabId) => void;
  // Privacy controls are only shown to parent / family admin users.
  includePrivacy?: boolean;
};

export function FamilySectionTabs({ activeTab, onChange, includePrivacy = false }: FamilySectionTabsProps) {
  const { t } = useLocale();
  const tabs: AppTabItem<FamilySectionTabId>[] = [
    { id: "members", label: t("family.tabs.members") },
    { id: "awards", label: t("family.tabs.awards") },
    { id: "categories", label: t("family.tabs.categories") },
    { id: "quests", label: t("family.tabs.quests") },
    ...(includePrivacy
      ? ([{ id: "privacy", label: t("family.tabs.privacy") }] as AppTabItem<FamilySectionTabId>[])
      : []),
  ];

  return <AppTabs ariaLabel={t("nav.manageFamily")} tabs={tabs} activeTab={activeTab} onChange={onChange} />;
}
