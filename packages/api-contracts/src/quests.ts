import { z } from "zod";
import { EntityId, QuestStatusSchema } from "./common";

export const QuestSummarySchema = z.object({
  questId: EntityId,
  title: z.string(),
  subtitle: z.string().optional(),
  completionStatus: QuestStatusSchema,
});

export const QuestChoiceInputSchema = z.object({
  choiceId: z.string().min(1),
  purchaseIfMissing: z.boolean().optional(),
});
