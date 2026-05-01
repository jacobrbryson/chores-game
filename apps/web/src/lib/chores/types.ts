export const CHORE_TYPES = ["normal", "group", "see_and_do"] as const;

export type ChoreType = (typeof CHORE_TYPES)[number];

export function normalizeChoreType(value: string | undefined, fallback: ChoreType = "normal"): ChoreType {
  if (value === "group" || value === "see_and_do" || value === "normal") {
    return value;
  }
  return fallback;
}
