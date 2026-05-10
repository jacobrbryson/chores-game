import { z } from "zod";
import { EntityId, RoleSchema } from "./common";

export const FamilyMemberSchema = z.object({
  id: EntityId,
  uid: z.string().optional(),
  name: z.string(),
  email: z.string().optional(),
  role: RoleSchema,
  status: z.enum(["active", "invited"]),
});

export const FamilyCurrentSchema = z.object({
  family: z.object({ id: EntityId, name: z.string() }).nullable(),
  members: z.array(FamilyMemberSchema),
  noFamily: z.boolean().default(false),
});
