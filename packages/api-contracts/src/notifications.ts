import { z } from "zod";
import { EntityId, ISODateString } from "./common";

export const NotificationSchema = z.object({
  id: EntityId,
  title: z.string(),
  message: z.string(),
  seen: z.boolean().default(false),
  createdAt: ISODateString.optional(),
});
