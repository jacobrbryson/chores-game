import type { FamilyActivityType } from "@/lib/ws/family-activity-event";

export function shouldReloadChoresPageList(type: FamilyActivityType) {
  return (
    type === "chore_created" ||
    type === "chore_updated" ||
    type === "chore_deleted" ||
    type === "chore_reordered"
  );
}

export function shouldReloadFamilySummary(type: FamilyActivityType) {
  return (
    type === "chore_completed" ||
    type === "chore_created" ||
    type === "chore_updated" ||
    type === "chore_deleted" ||
    type === "chore_reordered" ||
    type === "theme_changed" ||
    type === "avatar_changed"
  );
}
