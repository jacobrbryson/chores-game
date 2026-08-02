export const FAMILY_ACTIVITY_TYPES = [
  "chore_completed",
  "chore_approved",
  "chore_created",
  "chore_updated",
  "chore_deleted",
  "chore_reordered",
  "theme_changed",
  "avatar_changed",
  "quest_rewarded",
  "routine_updated",
  "routine_assigned",
  "routine_completed",
  "reward_claimed",
  "identity_title_unlocked",
  "family_reward_created",
] as const;

export type FamilyActivityType = (typeof FAMILY_ACTIVITY_TYPES)[number];

export type FamilyActivityEvent = {
  type: FamilyActivityType;
  familyId: string;
  choreId?: string;
  occurredAt: string;
};
