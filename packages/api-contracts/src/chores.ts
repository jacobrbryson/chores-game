import { z } from "zod";
import { ChoreStatusSchema, EntityId, ISODateString } from "./common";

export const ChoreSchema = z.object({
  id: EntityId,
  title: z.string(),
  status: ChoreStatusSchema,
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  dueDate: z.string().optional(),
  details: z.string().optional(),
  coinValue: z.number().int().nonnegative().default(0),
  requireApproval: z.boolean().default(false),
  createdAt: ISODateString.optional(),
});

export const ListChoresQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const CreateChoreInputSchema = z.object({
  description: z.string().min(1),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  details: z.string().optional(),
  coinValue: z.number().int().nonnegative().optional(),
  requireApproval: z.boolean().optional(),
});
