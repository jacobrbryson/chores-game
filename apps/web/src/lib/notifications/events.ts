import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  integerField,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { sendFamilyPushNotifications } from "@/lib/push/delivery";
import { runAfterResponse } from "@/lib/async/after-response";
import type { PushNotificationType } from "@/lib/push/constants";

type ActivityKind =
  | "chore_created"
  | "chore_edited"
  | "chore_deleted"
  | "chore_completed"
  | "chore_undo_completed"
  | "chore_skipped"
  | "chore_approved"
  | "chore_rejected"
  | "reward_claimed"
  | "routine_created"
  | "routine_updated"
  | "routine_assigned"
  | "routine_step_completed"
  | "routine_completed"
  | "identity_title_unlocked"
  | "family_reward_created";

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
  rewardId?: string;
  rewardDescription?: string;
  rewardCoinCost?: number;
  rewardImageId?: string;
  routineId?: string;
  routineName?: string;
  relatedIds?: string[];
  pushType?: PushNotificationType;
  // Kiosk Mode attribution. `source` distinguishes a shared-tablet completion
  // ("kiosk") from a normal in-app one ("app"). When the completion happened in
  // Kiosk Mode, `authenticatedUid` is the originally signed-in account while
  // `actorUid`/`completedForPlayerId` are the selected player.
  source?: string;
  authenticatedUid?: string;
  completedForPlayerId?: string;
  // New Skill Bonus attribution. Set when a child earned the one-time +5 bonus
  // as part of this completion/approval so feed/notification consumers can
  // celebrate it without re-deriving the state.
  newSkillBonusAwarded?: boolean;
  newSkillBonusAmount?: number;
  // Routine completion roll-up (routine_completed only). The steps that made up
  // the finished routine, snapshotted onto the event so the Family Feed can show
  // one condensed card listing every chore instead of one card per step.
  routineSteps?: RoutineActivityStep[];
};

export type RoutineActivityStep = {
  choreId: string;
  title: string;
  coinValue: number;
  skipped: boolean;
};

// Serialization caps for the routine roll-up. Routines are capped well below
// this in practice; the limits keep one runaway routine from bloating a
// notification document.
const MAX_ROUTINE_ACTIVITY_STEPS = 40;
const MAX_ROUTINE_STEP_TITLE = 120;

export function serializeRoutineActivitySteps(steps: RoutineActivityStep[] | undefined) {
  if (!steps?.length) {
    return "";
  }
  return JSON.stringify(
    steps.slice(0, MAX_ROUTINE_ACTIVITY_STEPS).map((step) => ({
      choreId: step.choreId,
      title: step.title.slice(0, MAX_ROUTINE_STEP_TITLE),
      coinValue: Math.max(0, Math.trunc(step.coinValue || 0)),
      skipped: step.skipped === true,
    })),
  );
}

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
      rewardId: stringField(input.rewardId ?? ""),
      rewardDescription: stringField(input.rewardDescription ?? ""),
      rewardCoinCost: integerField(input.rewardCoinCost ?? 0),
      rewardImageId: stringField(input.rewardImageId ?? ""),
      routineId: stringField(input.routineId ?? ""),
      routineName: stringField(input.routineName ?? ""),
      routineStepsJson: stringField(serializeRoutineActivitySteps(input.routineSteps)),
      relatedIds: stringArrayField(relatedIds),
      source: stringField(input.source ?? "app"),
      authenticatedUid: stringField(input.authenticatedUid ?? input.actorUid),
      completedForPlayerId: stringField(input.completedForPlayerId ?? ""),
      newSkillBonusAwarded: boolField(Boolean(input.newSkillBonusAwarded)),
      newSkillBonusAmount: integerField(
        input.newSkillBonusAwarded ? input.newSkillBonusAmount ?? 0 : 0,
      ),
      createdAt: timestampField(now),
    },
    input.idToken,
  );

  // The activity document above is written inline so the Family Activity Feed is
  // correct the instant the caller's response lands. Push delivery is not: it
  // reads the family's push recipients and then makes one web-push HTTP call per
  // recipient to Apple/Google, which is unbounded external latency that no
  // response depends on. It runs after the response is flushed.
  if (input.pushType) {
    const pushType = input.pushType;
    await runAfterResponse("notifications:push", async () => {
      try {
        await sendFamilyPushNotifications({
          familyId: input.familyId,
          idToken: input.idToken,
          actorUid: input.actorUid,
          type: pushType,
          title: input.title,
          body: input.message,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        console.error("[PUSH_NOTIFICATION_SEND_ERROR]", reason);
      }
    });
  }
}
