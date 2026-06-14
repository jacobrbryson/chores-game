export const FAMILY_ACTIVITY_TYPES = [
	"chore_completed",
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
] as const;

export type FamilyActivityType = (typeof FAMILY_ACTIVITY_TYPES)[number];

export type FamilyActivityEvent = {
	type: FamilyActivityType;
	familyId: string;
	choreId?: string;
	occurredAt: string;
};

export function isFamilyActivityType(value: unknown): value is FamilyActivityType {
	return (
		value === "chore_completed" ||
		value === "chore_created" ||
		value === "chore_updated" ||
		value === "chore_deleted" ||
		value === "chore_reordered" ||
		value === "theme_changed" ||
		value === "avatar_changed" ||
		value === "quest_rewarded" ||
		value === "routine_updated" ||
		value === "routine_assigned" ||
		value === "routine_completed"
	);
}
