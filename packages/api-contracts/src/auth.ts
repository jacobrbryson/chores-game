import { z } from "zod";
import { EntityId, LocaleSchema, RoleSchema } from "./common";

export const MeSchema = z.object({
  uid: EntityId,
  memberId: EntityId.optional(),
  name: z.string().default(""),
  email: z.string().default(""),
  role: RoleSchema,
  picture: z.string().default(""),
  avatarUrl: z.string().default(""),
  balance: z.number().int().nonnegative().default(0),
  locale: LocaleSchema.default("en-US"),
  resolvedLocale: LocaleSchema.default("en-US"),
  // Account-switch ("Switch To...") and Kiosk Mode state. `isSwitched` is true
  // while a guardian is acting as a single child profile; `kioskActive` is true
  // while a shared-tablet kiosk session is running. `authenticatedName` is the
  // original account's name so the UI can offer "Return to Parent" / "Exit".
  isSwitched: z.boolean().default(false),
  kioskActive: z.boolean().default(false),
  authenticatedName: z.string().default(""),
});

export const MeResponseSchema = MeSchema;
