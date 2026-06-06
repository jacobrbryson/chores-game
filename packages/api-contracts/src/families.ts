import { z } from "zod";
import { EntityId, LocaleSchema, RoleSchema } from "./common";

export const FamilyMemberSchema = z.object({
  id: EntityId,
  uid: z.string().optional(),
  name: z.string(),
  email: z.string().optional(),
  role: RoleSchema,
  status: z.enum(["active", "invited"]),
  dashboardPrimaryColor: z.string().optional(),
  avatarId: z.string().optional(),
  avatarPhotoUrl: z.string().optional(),
  locale: LocaleSchema.optional(),
  resolvedLocale: LocaleSchema.default("en-US"),
  stats: z.object({
    currentCoins: z.number().int().nonnegative().default(0),
  }).optional(),
});

export const FamilyDashboardChoreSchema = z.object({
  id: EntityId,
  title: z.string(),
  status: z.string(),
  sortOrder: z.number().optional(),
  assigneeId: z.string().optional(),
  assigneeIds: z.array(z.string()).optional(),
  assigneeScope: z.enum(["single", "multiple", "family"]).optional(),
  assigneeName: z.string().optional(),
  assigneePrimaryColor: z.string().optional(),
  assigneeAvatarId: z.string().optional(),
  assigneeAvatarPhotoUrl: z.string().optional(),
  categories: z.array(z.object({
    id: EntityId,
    name: z.string(),
    color: z.string(),
    memberId: z.string().optional(),
  })).optional(),
  coinValue: z.number().int().nonnegative().optional(),
  requireApproval: z.boolean().optional(),
  choreType: z.string().optional(),
  createdAt: z.string().optional(),
});

export const FamilyCurrentSchema = z.object({
  viewerUid: z.string().default(""),
  viewerAssigneeAliases: z.array(z.string()).default([]),
  family: z.object({
    id: EntityId,
    name: z.string(),
    defaultLocale: LocaleSchema.default("en-US"),
  }).nullable(),
  members: z.array(FamilyMemberSchema),
  choresToday: z.array(FamilyDashboardChoreSchema).default([]),
  noFamily: z.boolean().default(false),
  resolvedLocale: LocaleSchema.default("en-US"),
});
