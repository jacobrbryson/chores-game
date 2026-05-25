"use client";

import { AppTabs, type AppTabItem } from "@/components/app-tabs";

export type FamilySectionTabId = "members" | "awards" | "categories" | "quests";

const FAMILY_TABS: AppTabItem<FamilySectionTabId>[] = [
  { id: "members", label: "Members" },
  { id: "awards", label: "Awards" },
  { id: "categories", label: "Categories" },
  { id: "quests", label: "Quests" },
];

type FamilySectionTabsProps = {
  activeTab: FamilySectionTabId;
  onChange: (tabId: FamilySectionTabId) => void;
};

export function FamilySectionTabs({ activeTab, onChange }: FamilySectionTabsProps) {
  return <AppTabs ariaLabel="Family sections" tabs={FAMILY_TABS} activeTab={activeTab} onChange={onChange} />;
}
