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
