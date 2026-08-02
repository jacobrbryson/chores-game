export type MainNavigationItemId = "dashboard" | "store" | "achievements" | "more";

export type MainNavigationIcon = "list" | "coin" | "trophy" | "shield" | "avatar";

export type MainNavigationItem = {
  id: MainNavigationItemId;
  label: string;
  href?: string;
  icon: MainNavigationIcon;
};

export const mainNavigationItems: MainNavigationItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/", icon: "list" },
  { id: "store", label: "Store", href: "/store", icon: "coin" },
  { id: "achievements", label: "Achievements", href: "/achievements", icon: "trophy" },
  { id: "more", label: "More", icon: "avatar" },
];
