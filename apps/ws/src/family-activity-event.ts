export const FAMILY_ACTIVITY_TYPES = [
	"chore_completed",
	"chore_created",
	"chore_updated",
	"chore_deleted",
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

export function isFamilyActivityType(value: unknown): value is FamilyActivityType {
	return (
		value === "chore_completed" ||
		value === "chore_created" ||
		value === "chore_updated" ||
		value === "chore_deleted" ||
		value === "theme_changed" ||
		value === "avatar_changed"
	);
}
