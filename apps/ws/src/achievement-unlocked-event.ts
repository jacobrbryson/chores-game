export type AchievementUnlockedEvent = {
  type: "achievement:unlocked";
  achievementId: string;
  title: string;
  wittyTitle: string;
  description: string;
  imageUrl: string;
  completedAt: string;
  userId: string;
  familyId: string;
};

export function isAchievementUnlockedEvent(value: unknown): value is AchievementUnlockedEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "achievement:unlocked" &&
    typeof candidate.achievementId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.wittyTitle === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.imageUrl === "string" &&
    typeof candidate.completedAt === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.familyId === "string"
  );
}
