import { z } from "zod";
import { EntityId } from "./common";

export const RewardSchema = z.object({
  id: EntityId,
  title: z.string(),
  coinCost: z.number().int().nonnegative(),
  imageId: z.string().optional(),
  available: z.boolean().default(true),
});

export const RedeemRewardInputSchema = z.object({
  rewardId: EntityId,
});
