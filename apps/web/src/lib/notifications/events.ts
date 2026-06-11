import { randomUUID } from "node:crypto";
import {
  createOrReplaceDocument,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { sendFamilyPushNotifications } from "@/lib/push/delivery";
import type { PushNotificationType } from "@/lib/push/constants";

type ActivityKind =
  | "chore_created"
  | "chore_edited"
  | "chore_deleted"
  | "chore_completed"
  | "chore_undo_completed"
  | "chore_approved"
  | "chore_rejected"
  | "reward_claimed";

type EmitFamilyActivityInput = {
  familyId: string;
  idToken: string;
  kind: ActivityKind;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  title: string;
  message: string;
  choreId?: string;
  choreTitle?: string;
  relatedIds?: string[];
  pushType?: PushNotificationType;
  // Kiosk Mode attribution. `source` distinguishes a shared-tablet completion
  // ("kiosk") from a normal in-app one ("app"). When the completion happened in
  // Kiosk Mode, `authenticatedUid` is the originally signed-in account while
  // `actorUid`/`completedForPlayerId` are the selected player.
  source?: string;
  authenticatedUid?: string;
  completedForPlayerId?: string;
};

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

function uniqueRelatedIds(values: string[]) {
  const normalized = values
    .map((entry) => normalizeId(entry))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

export async function emitFamilyActivity(input: EmitFamilyActivityInput) {
  const now = new Date().toISOString();
  const relatedIds = uniqueRelatedIds([
    input.actorUid,
    input.actorEmail,
    ...(input.relatedIds ?? []),
  ]);

  await createOrReplaceDocument(
    `families/${input.familyId}/notifications/${randomUUID()}`,
    {
      familyId: stringField(input.familyId),
      kind: stringField(input.kind),
      actorUid: stringField(input.actorUid),
      actorEmail: stringField(input.actorEmail),
      actorName: stringField(input.actorName),
      title: stringField(input.title.slice(0, 180)),
      message: stringField(input.message.slice(0, 600)),
      choreId: stringField(input.choreId ?? ""),
      choreTitle: stringField(input.choreTitle ?? ""),
      relatedIds: stringArrayField(relatedIds),
      source: stringField(input.source ?? "app"),
      authenticatedUid: stringField(input.authenticatedUid ?? input.actorUid),
      completedForPlayerId: stringField(input.completedForPlayerId ?? ""),
      createdAt: timestampField(now),
    },
    input.idToken,
  );

  if (input.pushType) {
    try {
      await sendFamilyPushNotifications({
        familyId: input.familyId,
        idToken: input.idToken,
        actorUid: input.actorUid,
        type: input.pushType,
        title: input.title,
        body: input.message,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      console.error("[PUSH_NOTIFICATION_SEND_ERROR]", reason);
    }
  }
}
