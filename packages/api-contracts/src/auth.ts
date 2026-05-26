import { z } from "zod";
import { EntityId, RoleSchema } from "./common";

export const MeSchema = z.object({
  uid: EntityId,
  memberId: EntityId.optional(),
  name: z.string().default(""),
  email: z.string().default(""),
  role: RoleSchema,
  picture: z.string().default(""),
  avatarUrl: z.string().default(""),
  balance: z.number().int().nonnegative().default(0),
});

export const MeResponseSchema = MeSchema;
