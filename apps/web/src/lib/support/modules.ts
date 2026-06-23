export type SupportModuleId =
  | "dashboard"
  | "families"
  | "users"
  | "communication"
  | "requests"
  | "awards"
  | "quests"
  | "content"
  | "seo"
  | "responsibility"
  | "operations"
  | "analytics";

export const SUPPORT_MODULES: Array<{ id: SupportModuleId; label: string; href: string }> = [
  { id: "dashboard", label: "Dashboard", href: "/support/dashboard" },
  { id: "families", label: "Families", href: "/support/families" },
  { id: "users", label: "Users", href: "/support/users" },
  { id: "communication", label: "Communication", href: "/support/communication" },
  { id: "requests", label: "Requests", href: "/support/requests" },
  { id: "awards", label: "Awards", href: "/support/awards" },
  { id: "quests", label: "Quests", href: "/support/quests" },
  { id: "content", label: "Content", href: "/support/content" },
  { id: "seo", label: "SEO", href: "/support/seo" },
  { id: "responsibility", label: "Responsibility", href: "/support/responsibility" },
  { id: "operations", label: "Operations", href: "/support/operations" },
  { id: "analytics", label: "Analytics", href: "/support/analytics" },
];

export function isSupportModule(value: string): value is SupportModuleId {
  return SUPPORT_MODULES.some((module) => module.id === value);
}
