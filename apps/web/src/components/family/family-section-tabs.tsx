"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { useLocale } from "@/components/locale-provider";

export type FamilySectionTabId = "members" | "awards" | "categories" | "quests";

type FamilySectionTabsProps = {
  activeTab: FamilySectionTabId;
  onChange: (tabId: FamilySectionTabId) => void;
};

export function FamilySectionTabs({ activeTab, onChange }: FamilySectionTabsProps) {
  const { t } = useLocale();
  const tabs: AppTabItem<FamilySectionTabId>[] = [
    { id: "members", label: t("family.tabs.members") },
    { id: "awards", label: t("family.tabs.awards") },
    { id: "categories", label: t("family.tabs.categories") },
    { id: "quests", label: t("family.tabs.quests") },
  ];

  return <AppTabs ariaLabel={t("nav.manageFamily")} tabs={tabs} activeTab={activeTab} onChange={onChange} />;
}
