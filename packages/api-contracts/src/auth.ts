import { z } from "zod";
import { EntityId, RoleSchema } from "./common";

export const MeSchema = z.object({
  uid: EntityId,
  memberId: EntityId.optional(),
  name: z.string().default(""),
  email: z.string().default(""),
  role: RoleSchema,
});

export const MeResponseSchema = MeSchema;
