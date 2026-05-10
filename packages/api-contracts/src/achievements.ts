import { z } from "zod";
import { EntityId } from "./common";

export const AchievementProgressSchema = z.object({
  achievementId: EntityId,
  title: z.string(),
  percent: z.number().min(0).max(100),
  completed: z.boolean(),
});
