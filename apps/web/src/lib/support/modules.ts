export type SupportModuleId =
  | "dashboard"
  | "families"
  | "chores"
  | "users"
  | "communication"
  | "requests"
  | "awards"
  | "content"
  | "seo"
  | "responsibility"
  | "operations"
  | "analytics";

export const SUPPORT_MODULES: Array<{ id: SupportModuleId; label: string; href: string }> = [
  { id: "dashboard", label: "Dashboard", href: "/support/dashboard" },
  { id: "families", label: "Families", href: "/support/families" },
  { id: "chores", label: "Chores", href: "/support/chores" },
  { id: "users", label: "Users", href: "/support/users" },
  { id: "communication", label: "Communication", href: "/support/communication" },
  { id: "requests", label: "Requests", href: "/support/requests" },
  { id: "awards", label: "Awards", href: "/support/awards" },
  { id: "content", label: "Content", href: "/support/content" },
  { id: "seo", label: "SEO", href: "/support/seo" },
  { id: "responsibility", label: "Responsibility", href: "/support/responsibility" },
  { id: "operations", label: "Operations", href: "/support/operations" },
  { id: "analytics", label: "Analytics", href: "/support/analytics" },
];

// Top card holds the primary/most-used tabs; everything else appears in the card below.
export const SUPPORT_PRIMARY_MODULE_IDS: SupportModuleId[] = ["dashboard", "families", "chores"];

export function isSupportModule(value: string): value is SupportModuleId {
  return SUPPORT_MODULES.some((module) => module.id === value);
}
