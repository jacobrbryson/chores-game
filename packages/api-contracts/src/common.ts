import { z } from "zod";

export const ISODateString = z.string().datetime().brand("ISODateString");
export const EntityId = z.string().min(1).brand("EntityId");

export const RoleSchema = z.enum(["admin", "player"]);
export type Role = z.infer<typeof RoleSchema>;

export const ChoreStatusSchema = z.enum(["Open", "Submitted", "Approved", "Rejected", "Deleted"]);
export type ChoreStatus = z.infer<typeof ChoreStatusSchema>;

export const QuestStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ ok: z.literal(true), data: dataSchema });

export const ApiFailureSchema = z.object({ ok: z.literal(false), error: ApiErrorSchema });

export const ApiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([ApiSuccessSchema(dataSchema), ApiFailureSchema]);

export type ApiSuccess<T> = { ok: true; data: T };

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
});

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: PaginationSchema,
  });

export type PaginatedResponse<T> = {
  items: T[];
  pagination: z.infer<typeof PaginationSchema>;
};
