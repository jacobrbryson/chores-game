export const FAMILY_ACTIVITY_TYPES = [
  "chore_completed",
  "chore_created",
  "chore_updated",
  "chore_deleted",
  "chore_reordered",
  "theme_changed",
  "avatar_changed",
] as const;

export type FamilyActivityType = (typeof FAMILY_ACTIVITY_TYPES)[number];

export type FamilyActivityEvent = {
  type: FamilyActivityType;
  familyId: string;
  choreId?: string;
  occurredAt: string;
};
