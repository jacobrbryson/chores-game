import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  integerField,
  listAllDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  adminCommitWrites,
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { applyWalletDelta } from "@/lib/economy/wallet";
import {
  DEFAULT_CHORE_COIN_VALUE,
  nextRecurringDueDate,
  normalizeCoinValue,
  type ChoreRecurrenceConfig,
} from "@/lib/chores/recurrence";
import { routineFromDoc, type RoutineStep } from "@/lib/responsibility/routines";
import { loadResponsibilityConfig } from "@/lib/responsibility/config";
import { titleNameEn, titleUnlockTier } from "@/lib/responsibility/titles";
import {
  recordResponsibilityXpAwardBestEffort,
  recordRoutineCompletionStatsBestEffort,
} from "@/lib/responsibility/service";
import {
  hasAnyCompletedStep,
  isAssignmentComplete,
  overdueRoutineRolloverDueDate,
  resolveNextRecurringOccurrence,
  routineAssignmentFromDoc,
  shouldArchiveRoutineStepOnRollover,
  type RoutineAssignment,
  type RoutineAssignmentStep,
} from "@/lib/responsibility/assignments";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

// Server-side lifecycle for routine assignments.
//
// Assigning a routine materializes one ordinary chore document per step, so
// every existing chore behavior (completion, parent approval, the New Skill
// Bonus, Kiosk Mode, the activity feed) applies to routine steps with no
// special-casing. The assignment document is the umbrella record: it
// snapshots the steps, tracks which are done, and pays the routine-level
// rewards exactly once when the final step is paid out.

export type MaterializeRoutineAssignmentInput = {
  familyId: string;
  idToken: string;
  routine: {
    id: string;
    name: string;
    pillar: ResponsibilityPillar | "";
    completionBonusXp: number;
    completionBonusCoins: number;
  };
  steps: Array<{ id: string; title: string; coinValue: number; requireApproval: boolean }>;
  assigneeId: string;
  assigneeName: string;
  dueDate: string;
  recurrence: ChoreRecurrenceConfig;
  assignedBy: { uid: string; email: string; name: string };
  emitActivity?: boolean;
  // Firestore rules only let family admins create chores/assignments. The
  // assign route runs under the parent's own token, but the recurrence
  // respawn fires while a *player* completes the final step, so that path
  // writes with service-account credentials instead.
  useAdminCredentials?: boolean;
};

// The Firestore fields for one materialized routine-step chore. Step chores
// are ordinary chores, with one deliberate exception: the New Skill Bonus is
// always off. A routine step's reward is tied to doing the routine, not to
// whether the underlying skill is new to the child, so the "New Skill" badge
// and one-time bonus never apply to routine steps.
function routineStepChoreFields(input: {
  step: RoutineAssignmentStep;
  assignmentId: string;
  routine: { id: string; name: string; pillar: ResponsibilityPillar | "" };
  assigneeId: string;
  assigneeName: string;
  dueDate: string;
  stepCount: number;
  routineStepXp: number;
  createdByUid: string;
  now: string;
}): Record<string, FirestoreValue> {
  const { step } = input;
  return {
    title: stringField(step.title),
    choreType: stringField("normal"),
    status: stringField("Open"),
    assigneeId: stringField(input.assigneeId),
    assigneeIds: stringArrayField([input.assigneeId]),
    assigneeScope: stringField("single"),
    assigneeName: stringField(input.assigneeName),
    details: stringField(""),
    categoryIds: stringArrayField([]),
    dueDate: stringField(input.dueDate),
    coinValue: integerField(step.coinValue),
    requireApproval: boolField(step.requireApproval),
    // Routine steps never carry the New Skill Bonus (see note above).
    newSkillEnabled: boolField(false),
    // Step chores never recur individually — recurrence lives on the
    // assignment, which respawns a fresh set of steps when it completes.
    recurrenceType: stringField("none"),
    recurrenceInterval: integerField(0),
    recurrenceUnit: stringField(""),
    recurrenceDays: stringArrayField([]),
    responsibilityPillar: stringField(input.routine.pillar),
    // Steps award the configured routine-step XP instead of the default chore
    // XP (the chore XP hook honors this override field).
    responsibilityXpReward: integerField(input.routineStepXp),
    routineAssignmentId: stringField(input.assignmentId),
    routineId: stringField(input.routine.id),
    routineName: stringField(input.routine.name),
    routineStepId: stringField(step.id),
    routineStepOrder: integerField(step.order),
    routineStepCount: integerField(input.stepCount),
    deleted: boolField(false),
    createdBy: stringField(input.createdByUid),
    createdAt: timestampField(input.now),
    source: stringField("manual"),
  };
}

export async function materializeRoutineAssignment(
  input: MaterializeRoutineAssignmentInput,
): Promise<{ assignmentId: string; choreIds: string[] }> {
  const {
    familyId,
    idToken,
    routine,
    steps,
    assigneeId,
    assigneeName,
    dueDate,
    recurrence,
    assignedBy,
  } = input;
  const config = await loadResponsibilityConfig();
  const now = new Date().toISOString();
  const assignmentId = randomUUID();
  const writeDocument = input.useAdminCredentials
    ? (path: string, fields: Record<string, FirestoreValue>) =>
        adminCreateOrReplaceDocument(path, fields)
    : (path: string, fields: Record<string, FirestoreValue>) =>
        createOrReplaceDocument(path, fields, idToken);
  const assignmentSteps: RoutineAssignmentStep[] = steps.map((step, index) => ({
    id: step.id,
    title: step.title,
    order: index + 1,
    choreId: randomUUID(),
    coinValue: Math.max(0, Math.trunc(step.coinValue)),
    requireApproval: step.requireApproval === true,
  }));

  // Step chores first, assignment second: a half-written assignment without
  // chores would be invisible, while chores without an assignment would still
  // behave as plain chores — the safer failure mode.
  await Promise.all(
    assignmentSteps.map((step) =>
      writeDocument(
        `families/${familyId}/chores/${step.choreId}`,
        routineStepChoreFields({
          step,
          assignmentId,
          routine,
          assigneeId,
          assigneeName,
          dueDate,
          stepCount: assignmentSteps.length,
          routineStepXp: config.xpValues.routineStepXp,
          createdByUid: assignedBy.uid,
          now,
        }),
      ),
    ),
  );

  await writeDocument(
    `families/${familyId}/routineAssignments/${assignmentId}`,
    {
      routineId: stringField(routine.id),
      routineName: stringField(routine.name),
      pillar: stringField(routine.pillar),
      assigneeId: stringField(assigneeId),
      assigneeName: stringField(assigneeName),
      assignedBy: stringField(assignedBy.uid),
      status: stringField("active"),
      requireApproval: boolField(assignmentSteps.some((step) => step.requireApproval)),
      stepsJson: stringField(JSON.stringify(assignmentSteps)),
      completedStepIdsJson: stringField("[]"),
      skippedStepIdsJson: stringField("[]"),
      completionBonusXp: integerField(routine.completionBonusXp),
      completionBonusCoins: integerField(routine.completionBonusCoins),
      dueDate: stringField(dueDate),
      recurrenceType: stringField(recurrence.recurrenceType),
      recurrenceInterval: integerField(recurrence.recurrenceInterval ?? 0),
      recurrenceUnit: stringField(recurrence.recurrenceUnit ?? ""),
      recurrenceDays: stringArrayField(recurrence.recurrenceDays ?? []),
      createdAt: timestampField(now),
      updatedAt: timestampField(now),
    },
  );

  // Bump the template's usage counter (best effort — stats only).
  try {
    const routinePath = `families/${familyId}/routines/${routine.id}`;
    if (input.useAdminCredentials) {
      const routineDoc = await adminGetDocument(routinePath);
      await adminPatchDocument(
        routinePath,
        {
          timesUsed: integerField(readInteger(routineDoc.fields, "timesUsed") + 1),
          lastAssignedAt: timestampField(now),
        },
        ["timesUsed", "lastAssignedAt"],
      );
    } else {
      const routineDoc = await getDocument(routinePath, idToken);
      await patchDocument(
        routinePath,
        {
          timesUsed: integerField(readInteger(routineDoc.fields, "timesUsed") + 1),
          lastAssignedAt: timestampField(now),
        },
        idToken,
        ["timesUsed", "lastAssignedAt"],
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    console.error("[ROUTINE_TIMES_USED_ERROR]", { familyId, routineId: routine.id, reason });
  }

  if (input.emitActivity !== false) {
    // One grouped event for the whole assignment instead of one chore_created
    // event per step — keeps the family feed readable.
    await emitFamilyActivity({
      familyId,
      idToken,
      kind: "routine_assigned",
      actorUid: assignedBy.uid,
      actorEmail: assignedBy.email,
      actorName: assignedBy.name,
      title: "Routine assigned",
      message: `${assignedBy.name || "A parent"} assigned the "${routine.name}" routine (${assignmentSteps.length} steps) to ${assigneeName}.`,
      relatedIds: [assigneeId],
    });
    await publishFamilyActivity({
      type: "routine_assigned",
      familyId,
      occurredAt: now,
    });
  }

  return { assignmentId, choreIds: assignmentSteps.map((step) => step.choreId) };
}

const MAX_ROUTINE_ROLLOVER_ASSIGNMENTS = 1000;

// Replaces overdue, unfinished scheduled routine occurrences with a fresh
// occurrence for the latest scheduled date. The rollover is one atomic
// Firestore commit: concurrent dashboard loads cannot create duplicates, and
// a step being completed at the same moment makes the commit retry safely on
// the next read. Completed/Submitted step chores are preserved so their coins,
// approvals, XP, and audit history remain intact; only unresolved Open/Skipped
// chores are archived.
export async function rolloverOverdueRoutineAssignmentsBestEffort(input: {
  familyId: string;
  idToken: string;
  today: string;
  actor?: { uid?: string; email?: string; name?: string };
}): Promise<number> {
  const { familyId, idToken, today, actor } = input;
  try {
    const assignmentDocs = await listAllDocuments(
      `families/${familyId}/routineAssignments`,
      idToken,
      { cap: MAX_ROUTINE_ROLLOVER_ASSIGNMENTS },
    );
    const overdue = assignmentDocs
      .filter((doc) => !readBoolean(doc.fields, "deleted"))
      .map((doc) => ({ doc, assignment: routineAssignmentFromDoc(doc) }))
      .map((entry) => ({
        ...entry,
        nextDueDate: overdueRoutineRolloverDueDate(entry.assignment, today),
      }))
      .filter(
        (entry): entry is typeof entry & { nextDueDate: string } =>
          Boolean(entry.nextDueDate),
      );
    if (overdue.length === 0) {
      return 0;
    }

    const config = await loadResponsibilityConfig();
    let rolledOver = 0;
    for (const { doc: assignmentDoc, assignment, nextDueDate } of overdue) {
      try {
        let nextOccurrence = resolveNextRecurringOccurrence(assignment, null);
        try {
          const templateDoc = await adminGetDocument(
            `families/${familyId}/routines/${assignment.routineId}`,
          );
          if (!readBoolean(templateDoc.fields, "deleted")) {
            nextOccurrence = resolveNextRecurringOccurrence(
              assignment,
              routineFromDoc(templateDoc),
            );
          }
        } catch {
          // A deleted/unavailable template must not stop an assigned routine;
          // its immutable occurrence snapshot is a valid fallback.
        }

        const oldStepDocs = await Promise.all(
          assignment.steps.map(async (step) => {
            try {
              return { step, doc: await adminGetDocument(`families/${familyId}/chores/${step.choreId}`) };
            } catch {
              return { step, doc: null };
            }
          }),
        );
        const now = new Date().toISOString();
        const nextAssignmentId = randomUUID();
        const nextSteps: RoutineAssignmentStep[] = nextOccurrence.steps.map((step, index) => ({
          id: step.id,
          title: step.title,
          order: index + 1,
          choreId: randomUUID(),
          coinValue: Math.max(0, Math.trunc(step.coinValue)),
          requireApproval: step.requireApproval === true,
        }));
        const recurrence: ChoreRecurrenceConfig = {
          recurrenceType: assignment.recurrenceType,
          recurrenceInterval: assignment.recurrenceInterval,
          recurrenceUnit: assignment.recurrenceUnit,
          recurrenceDays: assignment.recurrenceDays,
        };

        await adminCommitWrites([
          {
            update: {
              path: `families/${familyId}/routineAssignments/${assignment.id}`,
              fields: {
                status: stringField("expired"),
                expiredAt: timestampField(now),
                updatedAt: timestampField(now),
                rolloverAssignmentId: stringField(nextAssignmentId),
              },
              updateMask: ["status", "expiredAt", "updatedAt", "rolloverAssignmentId"],
              currentDocument: assignmentDoc.updateTime
                ? { updateTime: assignmentDoc.updateTime }
                : { exists: true },
            },
          },
          ...oldStepDocs
            .filter(({ doc }) => {
              if (!doc) {
                return false;
              }
              const status = readString(doc.fields, "status") || "Open";
              return shouldArchiveRoutineStepOnRollover(
                status,
                readBoolean(doc.fields, "deleted"),
              );
            })
            .map(({ step, doc }) => ({
              update: {
                path: `families/${familyId}/chores/${step.choreId}`,
                fields: {
                  deleted: boolField(true),
                  deletedAt: timestampField(now),
                  status: stringField("Archived"),
                  updatedAt: timestampField(now),
                },
                updateMask: ["deleted", "deletedAt", "status", "updatedAt"],
                currentDocument: doc?.updateTime ? { updateTime: doc.updateTime } : { exists: true },
              },
            })),
          ...nextSteps.map((step) => ({
            update: {
              path: `families/${familyId}/chores/${step.choreId}`,
              fields: routineStepChoreFields({
                step,
                assignmentId: nextAssignmentId,
                routine: nextOccurrence.routine,
                assigneeId: assignment.assigneeId,
                assigneeName: assignment.assigneeName,
                dueDate: nextDueDate,
                stepCount: nextSteps.length,
                routineStepXp: config.xpValues.routineStepXp,
                createdByUid: assignment.assignedBy,
                now,
              }),
              currentDocument: { exists: false },
            },
          })),
          {
            update: {
              path: `families/${familyId}/routineAssignments/${nextAssignmentId}`,
              fields: {
                routineId: stringField(nextOccurrence.routine.id),
                routineName: stringField(nextOccurrence.routine.name),
                pillar: stringField(nextOccurrence.routine.pillar),
                assigneeId: stringField(assignment.assigneeId),
                assigneeName: stringField(assignment.assigneeName),
                assignedBy: stringField(assignment.assignedBy),
                status: stringField("active"),
                requireApproval: boolField(nextSteps.some((step) => step.requireApproval)),
                stepsJson: stringField(JSON.stringify(nextSteps)),
                completedStepIdsJson: stringField("[]"),
                skippedStepIdsJson: stringField("[]"),
                completionBonusXp: integerField(nextOccurrence.routine.completionBonusXp),
                completionBonusCoins: integerField(nextOccurrence.routine.completionBonusCoins),
                dueDate: stringField(nextDueDate),
                recurrenceType: stringField(recurrence.recurrenceType),
                recurrenceInterval: integerField(recurrence.recurrenceInterval ?? 0),
                recurrenceUnit: stringField(recurrence.recurrenceUnit ?? ""),
                recurrenceDays: stringArrayField(recurrence.recurrenceDays ?? []),
                recurrenceParentAssignmentId: stringField(assignment.id),
                createdAt: timestampField(now),
                updatedAt: timestampField(now),
              },
              currentDocument: { exists: false },
            },
          },
        ]);

        rolledOver += 1;
        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "routine_occurrence_reset",
          actor: { ...actor, role: "system" },
          userId: assignment.assigneeId,
          previous: {
            assignmentId: assignment.id,
            dueDate: assignment.dueDate,
            completedSteps: assignment.completedStepIds.length,
          },
          next: { assignmentId: nextAssignmentId, dueDate: nextDueDate },
          reason: "scheduled_routine_rollover",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : "unknown";
        console.warn("[ROUTINE_ROLLOVER_SKIPPED]", {
          familyId,
          assignmentId: assignment.id,
          reason,
        });
      }
    }
    return rolledOver;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    console.warn("[ROUTINE_ROLLOVER_ERROR]", { familyId, reason });
    return 0;
  }
}

export type RoutineStepProgressOutcome = {
  assignmentId: string;
  routineId: string;
  routineName: string;
  pillar: ResponsibilityPillar | "";
  completedSteps: number;
  skippedSteps: number;
  totalSteps: number;
  routineCompleted: boolean;
  completionBonusXpAwarded: number;
  completionBonusCoinsAwarded: number;
};

// Pays out a routine assignment that has just become complete: completion
// bonus XP + coins, completion stats, template counter, audit, family-feed
// celebration, and (for recurring assignments) the next occurrence. Assumes
// the caller has already flipped the assignment's status to "completed". The
// coin bonus is idempotent on the wallet ledger's assignment-scoped entry id,
// so a replay never double-pays. Shared by the normal step-completion path and
// the template-edit reconciler.
async function finalizeRoutineCompletion(input: {
  familyId: string;
  idToken: string;
  assignment: RoutineAssignment;
  playerUid: string;
  actor: { uid: string; email: string; name: string };
  actorRole: "admin" | "player";
  now: string;
  kiosk?: { source: string; authenticatedUid: string; completedForPlayerId: string };
}): Promise<{ completionBonusXpAwarded: number; completionBonusCoinsAwarded: number }> {
  const { familyId, idToken, assignment, playerUid, actor, actorRole, now, kiosk } = input;
  const assignmentId = assignment.id;
  const config = await loadResponsibilityConfig();
  const bonusXp =
    assignment.completionBonusXp >= 0
      ? assignment.completionBonusXp
      : config.xpValues.routineCompletionBonusXp;
  let completionBonusXpAwarded = 0;
  let titleUnlock: { tier: number } | null = null;
  if (assignment.pillar && bonusXp > 0 && playerUid) {
    const { ok, result } = await recordResponsibilityXpAwardBestEffort({
      familyId,
      idToken,
      award: {
        playerId: playerUid,
        pillar: assignment.pillar,
        xpAwarded: bonusXp,
        eventType: "routine_completed",
        routineId: assignment.routineId,
      },
    });
    if (ok) {
      completionBonusXpAwarded = bonusXp;
    }
    if (result) {
      const unlockedTier = titleUnlockTier(
        result.pillarXpBefore,
        result.pillarXpAfter,
        config.levelThresholds,
      );
      if (unlockedTier !== null) {
        titleUnlock = { tier: unlockedTier };
      }
    }
  }

  let completionBonusCoinsAwarded = 0;
  if (assignment.completionBonusCoins > 0 && playerUid) {
    try {
      await applyWalletDelta({
        uid: playerUid,
        idToken,
        delta: assignment.completionBonusCoins,
        reason: "routine_completion_bonus",
        routineAssignmentId: assignmentId,
        debugMeta: { familyId, routineId: assignment.routineId, assignmentId },
      });
      completionBonusCoinsAwarded = assignment.completionBonusCoins;
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
      console.error("[ROUTINE_BONUS_COINS_ERROR]", { familyId, assignmentId, reason });
    }
  }

  if (playerUid) {
    await recordRoutineCompletionStatsBestEffort({
      familyId,
      idToken,
      playerId: playerUid,
      routineId: assignment.routineId,
      routineName: assignment.routineName,
    });
  }

  // Template completion counter (best effort — stats only). Admin
  // credentials because the completing actor is usually a player, and
  // routine templates are admin-write-only under security rules.
  try {
    const routinePath = `families/${familyId}/routines/${assignment.routineId}`;
    const routineDoc = await adminGetDocument(routinePath);
    await adminPatchDocument(
      routinePath,
      {
        timesCompleted: integerField(readInteger(routineDoc.fields, "timesCompleted") + 1),
      },
      ["timesCompleted"],
    );
  } catch {
    // Template may have been deleted since assignment (or admin credentials
    // are unavailable in this environment) — history stays valid.
  }

  await writeAuditLogBestEffort({
    familyId,
    idToken,
    eventType: "routine_completed",
    actor: { uid: actor.uid, email: actor.email, name: actor.name, role: actorRole },
    userId: playerUid,
    next: {
      routineId: assignment.routineId,
      assignmentId,
      stepCount: assignment.steps.length,
      completionBonusXpAwarded,
      completionBonusCoinsAwarded,
    },
    reason: "complete_routine",
  });
  const celebrationName = assignment.assigneeName || actor.name;
  // Snapshot the routine's steps onto the celebration event so the Family Feed
  // can collapse the per-step chore events into this single card.
  const skippedStepIds = new Set(assignment.skippedStepIds);
  const activitySteps = [...assignment.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => ({
      choreId: step.choreId,
      title: step.title,
      coinValue: step.coinValue,
      skipped: skippedStepIds.has(step.id),
    }));
  await emitFamilyActivity({
    familyId,
    idToken,
    kind: "routine_completed",
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorName: actor.name,
    title: "Routine completed",
    message: `🎉 ${celebrationName} finished the "${assignment.routineName}" routine${completionBonusCoinsAwarded > 0 ? ` and earned ${completionBonusCoinsAwarded} bonus coins` : ""}!`,
    routineId: assignment.routineId,
    routineName: assignment.routineName,
    routineSteps: activitySteps,
    relatedIds: [playerUid, assignment.assigneeId],
    source: kiosk?.source,
    authenticatedUid: kiosk?.authenticatedUid,
    completedForPlayerId: kiosk?.completedForPlayerId,
  });
  await publishFamilyActivity({
    type: "routine_completed",
    familyId,
    occurredAt: now,
  });

  // Responsibility Identity: when the completion bonus pushed the player into a
  // new title tier, announce it as its own celebratory feed line (reusing the
  // routine_completed kind so no new ActivityKind/WS type is needed).
  if (titleUnlock && assignment.pillar) {
    const titleName = titleNameEn(assignment.pillar, titleUnlock.tier);
    await emitFamilyActivity({
      familyId,
      idToken,
      kind: "identity_title_unlocked",
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorName: actor.name,
      title: "New title unlocked",
      message: `🎉 ${celebrationName} became a ${titleName}!`,
      relatedIds: [playerUid, assignment.assigneeId],
      source: kiosk?.source,
      authenticatedUid: kiosk?.authenticatedUid,
      completedForPlayerId: kiosk?.completedForPlayerId,
    });
    await publishFamilyActivity({
      type: "identity_title_unlocked",
      familyId,
      occurredAt: now,
    });
  }

  // Recurring assignment: spawn the next occurrence with a fresh set of
  // step chores, exactly like recurring chores clone themselves on
  // completion.
  if (assignment.recurrenceType !== "none") {
    const recurrence: ChoreRecurrenceConfig = {
      recurrenceType: assignment.recurrenceType,
      recurrenceInterval: assignment.recurrenceInterval,
      recurrenceUnit: assignment.recurrenceUnit,
      recurrenceDays: assignment.recurrenceDays,
    };
    const today = now.slice(0, 10);
    // Advance from the completion date, not the assignment's (possibly stale)
    // dueDate, mirroring how recurring chores clone on completion
    // (see complete.ts). Basing on assignment.dueDate spawns a same-day
    // occurrence whenever a routine is completed late: e.g. a daily routine
    // due yesterday + 1 day = today.
    const nextDueDate = nextRecurringDueDate(today, recurrence, today);
    try {
      // The current occurrence remains an immutable snapshot, but the next
      // occurrence should use the latest template. This lets parents edit a
      // recurring routine without changing today's progress.
      let nextOccurrence = resolveNextRecurringOccurrence(assignment, null);
      try {
        const templateDoc = await adminGetDocument(
          `families/${familyId}/routines/${assignment.routineId}`,
        );
        if (!readBoolean(templateDoc.fields, "deleted")) {
          const template = routineFromDoc(templateDoc);
          nextOccurrence = resolveNextRecurringOccurrence(assignment, template);
        }
      } catch {
        // If the template was deleted or cannot be read, preserve the
        // assignment snapshot so recurrence remains reliable.
      }
      await materializeRoutineAssignment({
        familyId,
        idToken,
        routine: nextOccurrence.routine,
        steps: nextOccurrence.steps,
        assigneeId: assignment.assigneeId,
        assigneeName: assignment.assigneeName,
        dueDate: nextDueDate,
        recurrence,
        assignedBy: { uid: assignment.assignedBy, email: "", name: "" },
        // The original assignment event already announced this routine;
        // recurring respawns stay quiet to avoid feed spam.
        emitActivity: false,
        // The completing actor is usually a player, who may not create
        // chores/assignments under security rules.
        useAdminCredentials: true,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
      console.error("[ROUTINE_RECURRENCE_SPAWN_ERROR]", { familyId, assignmentId, reason });
    }
  }

  return { completionBonusXpAwarded, completionBonusCoinsAwarded };
}

// Folds a paid step-chore completion into its routine assignment. Called from
// the chore PATCH route at the same lifecycle point as the coin payout (i.e.
// immediately for auto-approved chores, on approval otherwise). Idempotent:
// replaying a step that is already recorded is a no-op, and the completion
// bonus is additionally guarded by the wallet ledger's deterministic entry id.
export async function recordRoutineStepCompletionBestEffort(input: {
  familyId: string;
  idToken: string;
  choreId: string;
  choreFields: Record<string, FirestoreValue> | undefined;
  playerUid: string;
  actor: { uid: string; email: string; name: string };
  kiosk?: { source: string; authenticatedUid: string; completedForPlayerId: string };
}): Promise<RoutineStepProgressOutcome | null> {
  const { familyId, idToken, choreId, choreFields, playerUid, actor, kiosk } = input;
  const assignmentId = readString(choreFields, "routineAssignmentId");
  const stepId = readString(choreFields, "routineStepId");
  if (!assignmentId || !stepId) {
    return null;
  }
  try {
    const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
    const assignmentDoc = await getDocument(assignmentPath, idToken);
    const assignment = routineAssignmentFromDoc(assignmentDoc);
    if (assignment.completedStepIds.includes(stepId) || assignment.status !== "active") {
      return progressSnapshot(assignment, false, 0, 0);
    }
    const completedStepIds = [...assignment.completedStepIds, stepId];
    // Completing a step that had been skipped (picked back up from the progress
    // dialog) clears it from the skipped set so it counts as real work.
    const skippedStepIds = assignment.skippedStepIds.filter((id) => id !== stepId);
    const wasSkipped = skippedStepIds.length !== assignment.skippedStepIds.length;
    const updated: RoutineAssignment = { ...assignment, completedStepIds, skippedStepIds };
    const routineCompleted = isAssignmentComplete(updated);
    const now = new Date().toISOString();
    await patchDocument(
      assignmentPath,
      {
        completedStepIdsJson: stringField(JSON.stringify(completedStepIds)),
        ...(wasSkipped ? { skippedStepIdsJson: stringField(JSON.stringify(skippedStepIds)) } : {}),
        status: stringField(routineCompleted ? "completed" : "active"),
        updatedAt: timestampField(now),
        ...(routineCompleted ? { completedAt: timestampField(now) } : {}),
      },
      idToken,
      [
        "completedStepIdsJson",
        ...(wasSkipped ? ["skippedStepIdsJson"] : []),
        "status",
        "updatedAt",
        ...(routineCompleted ? ["completedAt"] : []),
      ],
    );

    if (!routineCompleted) {
      return progressSnapshot(updated, false, 0, 0);
    }

    const { completionBonusXpAwarded, completionBonusCoinsAwarded } =
      await finalizeRoutineCompletion({
        familyId,
        idToken,
        assignment: updated,
        playerUid,
        actor,
        actorRole: "player",
        now,
        kiosk,
      });

    return progressSnapshot(updated, true, completionBonusXpAwarded, completionBonusCoinsAwarded);
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_STEP_PROGRESS_ERROR]", { familyId, choreId, assignmentId, reason });
    return null;
  }
}

// Reverses a step's progress mark when a chore completion is undone before
// the routine finished. Bonuses already paid for a completed routine are not
// clawed back — the wallet ledger keeps the completion bonus idempotent, so a
// re-completion will not double-pay.
export async function recordRoutineStepUndoBestEffort(input: {
  familyId: string;
  idToken: string;
  choreFields: Record<string, FirestoreValue> | undefined;
}): Promise<void> {
  const { familyId, idToken, choreFields } = input;
  const assignmentId = readString(choreFields, "routineAssignmentId");
  const stepId = readString(choreFields, "routineStepId");
  if (!assignmentId || !stepId) {
    return;
  }
  try {
    const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
    const assignmentDoc = await getDocument(assignmentPath, idToken);
    const assignment = routineAssignmentFromDoc(assignmentDoc);
    if (assignment.status !== "active" || !assignment.completedStepIds.includes(stepId)) {
      return;
    }
    const completedStepIds = assignment.completedStepIds.filter((id) => id !== stepId);
    await patchDocument(
      assignmentPath,
      {
        completedStepIdsJson: stringField(JSON.stringify(completedStepIds)),
        status: stringField("active"),
        updatedAt: timestampField(new Date().toISOString()),
      },
      idToken,
      ["completedStepIdsJson", "status", "updatedAt"],
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_STEP_UNDO_ERROR]", { familyId, assignmentId, reason });
  }
}

// Marks a routine step as skipped inside its assignment. Called from the chore
// PATCH "skip" action at the point the step chore is set to "Skipped". A
// skipped step resolves the routine for completion purposes but pays no step
// coins. When skipping resolves the final step, the routine is finalized —
// but the completion bonus is paid only when at least one step was actually
// completed (a routine where every step was skipped earns nothing). Idempotent:
// re-skipping an already-skipped (or already-completed) step is a no-op.
export async function recordRoutineStepSkipBestEffort(input: {
  familyId: string;
  idToken: string;
  choreId: string;
  choreFields: Record<string, FirestoreValue> | undefined;
  playerUid: string;
  actor: { uid: string; email: string; name: string };
  actorRole: "admin" | "player";
  kiosk?: { source: string; authenticatedUid: string; completedForPlayerId: string };
}): Promise<RoutineStepProgressOutcome | null> {
  const { familyId, idToken, choreId, choreFields, playerUid, actor, actorRole, kiosk } = input;
  const assignmentId = readString(choreFields, "routineAssignmentId");
  const stepId = readString(choreFields, "routineStepId");
  if (!assignmentId || !stepId) {
    return null;
  }
  try {
    const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
    const assignmentDoc = await getDocument(assignmentPath, idToken);
    const assignment = routineAssignmentFromDoc(assignmentDoc);
    if (
      assignment.skippedStepIds.includes(stepId) ||
      assignment.completedStepIds.includes(stepId) ||
      assignment.status !== "active"
    ) {
      return progressSnapshot(assignment, false, 0, 0);
    }
    const skippedStepIds = [...assignment.skippedStepIds, stepId];
    const updated: RoutineAssignment = { ...assignment, skippedStepIds };
    const routineCompleted = isAssignmentComplete(updated);
    const now = new Date().toISOString();
    await patchDocument(
      assignmentPath,
      {
        skippedStepIdsJson: stringField(JSON.stringify(skippedStepIds)),
        status: stringField(routineCompleted ? "completed" : "active"),
        updatedAt: timestampField(now),
        ...(routineCompleted ? { completedAt: timestampField(now) } : {}),
      },
      idToken,
      [
        "skippedStepIdsJson",
        "status",
        "updatedAt",
        ...(routineCompleted ? ["completedAt"] : []),
      ],
    );

    // Only pay out when the routine is finished AND at least one step was
    // actually completed — never for a routine that was entirely skipped.
    if (!routineCompleted || !hasAnyCompletedStep(updated)) {
      return progressSnapshot(updated, routineCompleted, 0, 0);
    }

    const { completionBonusXpAwarded, completionBonusCoinsAwarded } =
      await finalizeRoutineCompletion({
        familyId,
        idToken,
        assignment: updated,
        playerUid,
        actor,
        actorRole,
        now,
        kiosk,
      });

    return progressSnapshot(updated, true, completionBonusXpAwarded, completionBonusCoinsAwarded);
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_STEP_SKIP_ERROR]", { familyId, choreId, assignmentId, reason });
    return null;
  }
}

// Reverses a skip when a parent un-skips a step (the chore returns to Open). The
// assignment drops back to active; any completion bonus already paid for a
// finished routine is not clawed back (the wallet ledger keeps it idempotent).
export async function recordRoutineStepUnskipBestEffort(input: {
  familyId: string;
  idToken: string;
  choreFields: Record<string, FirestoreValue> | undefined;
}): Promise<void> {
  const { familyId, idToken, choreFields } = input;
  const assignmentId = readString(choreFields, "routineAssignmentId");
  const stepId = readString(choreFields, "routineStepId");
  if (!assignmentId || !stepId) {
    return;
  }
  try {
    const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
    const assignmentDoc = await getDocument(assignmentPath, idToken);
    const assignment = routineAssignmentFromDoc(assignmentDoc);
    if (!assignment.skippedStepIds.includes(stepId)) {
      return;
    }
    const skippedStepIds = assignment.skippedStepIds.filter((id) => id !== stepId);
    await patchDocument(
      assignmentPath,
      {
        skippedStepIdsJson: stringField(JSON.stringify(skippedStepIds)),
        status: stringField("active"),
        updatedAt: timestampField(new Date().toISOString()),
      },
      idToken,
      ["skippedStepIdsJson", "status", "updatedAt"],
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_STEP_UNSKIP_ERROR]", { familyId, assignmentId, reason });
  }
}

// Reassigns a whole routine to a new child when the assignee of one of its step
// chores is changed (the only way the UI exposes "move this routine to someone
// else"). Editing a single step chore would otherwise only repoint that one
// chore, scattering the routine's steps across kids and desyncing the
// assignment document from its own steps. Here we keep the routine cohesive:
// every still-open step chore and the assignment record itself move to the new
// assignee. Steps the original child already finished or submitted stay with
// them — that work (and any coins) is theirs and remains in the routine's
// history. Best-effort: a failure never fails the underlying chore edit.
export async function reassignRoutineAssignmentBestEffort(input: {
  familyId: string;
  idToken: string;
  assignmentId: string;
  assigneeId: string;
  assigneeName: string;
  // The step chore the caller already repointed (skip re-patching it).
  excludeChoreId?: string;
  actor: { uid: string; email: string; name: string };
}): Promise<void> {
  const { familyId, idToken, assignmentId, assigneeId, assigneeName, excludeChoreId, actor } =
    input;
  if (!assignmentId || !assigneeId) {
    return;
  }
  try {
    const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
    const assignmentDoc = await getDocument(assignmentPath, idToken);
    if (readBoolean(assignmentDoc.fields, "deleted")) {
      return;
    }
    const assignment = routineAssignmentFromDoc(assignmentDoc);
    const now = new Date().toISOString();
    // Repoint each still-open step chore. Completed/submitted/skipped steps keep
    // their existing assignee so the original child's record is preserved.
    await Promise.all(
      assignment.steps
        .filter((step) => step.choreId && step.choreId !== excludeChoreId)
        .map(async (step) => {
          try {
            const choreDoc = await getDocument(
              `families/${familyId}/chores/${step.choreId}`,
              idToken,
            );
            if (readBoolean(choreDoc.fields, "deleted")) {
              return;
            }
            if ((readString(choreDoc.fields, "status") || "Open") !== "Open") {
              return;
            }
            await patchDocument(
              `families/${familyId}/chores/${step.choreId}`,
              {
                assigneeId: stringField(assigneeId),
                assigneeIds: stringArrayField([assigneeId]),
                assigneeScope: stringField("single"),
                assigneeName: stringField(assigneeName),
                updatedAt: timestampField(now),
              },
              idToken,
              ["assigneeId", "assigneeIds", "assigneeScope", "assigneeName", "updatedAt"],
            );
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            if (!reason.includes("FIRESTORE_HTTP_404")) {
              throw error;
            }
          }
        }),
    );
    await patchDocument(
      assignmentPath,
      {
        assigneeId: stringField(assigneeId),
        assigneeName: stringField(assigneeName),
        updatedAt: timestampField(now),
      },
      idToken,
      ["assigneeId", "assigneeName", "updatedAt"],
    );
    await writeAuditLogBestEffort({
      familyId,
      idToken,
      eventType: "routine_updated",
      actor: { uid: actor.uid, email: actor.email, name: actor.name, role: "admin" },
      userId: assigneeId,
      previous: { assigneeId: assignment.assigneeId, assigneeName: assignment.assigneeName },
      next: { assignmentId, routineId: assignment.routineId, assigneeId, assigneeName },
      reason: "reassign_routine_assignment",
    });
    await publishFamilyActivity({
      type: "routine_updated",
      familyId,
      occurredAt: now,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_REASSIGN_ERROR]", { familyId, assignmentId, reason });
  }
}

const MAX_CHORE_SCAN = 4000;
const MAX_ASSIGNMENT_SCAN = 2000;

function normalizeStepTitleKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Propagates an edited routine template's steps onto its *active* (still
// in-flight) assignments. Editing a template normally never rewrites history,
// but parents expect structural edits — adding, removing, renaming, or
// reordering steps (e.g. moving a chore from one routine to another) — to show
// up in routines already assigned to their kids. Completed assignments are
// left untouched. Best-effort: a failure here never fails the template save.
export async function syncRoutineStepsToActiveAssignments(input: {
  familyId: string;
  idToken: string;
  routine: { id: string; name: string; pillar: ResponsibilityPillar | "" };
  steps: RoutineStep[];
  actor: { uid: string; email: string; name: string };
}): Promise<void> {
  const { familyId, idToken, routine, steps, actor } = input;
  try {
    const assignmentDocs = await listAllDocuments(
      `families/${familyId}/routineAssignments`,
      idToken,
      { cap: MAX_ASSIGNMENT_SCAN },
    );
    const activeAssignments = assignmentDocs
      .filter((doc) => !readBoolean(doc.fields, "deleted"))
      .map((doc) => routineAssignmentFromDoc(doc))
      .filter(
        (assignment) =>
          assignment.routineId === routine.id && assignment.status === "active",
      );
    if (activeAssignments.length === 0) {
      return;
    }

    // Brand-new steps inherit coins/approval from the family's existing chore
    // with the same title (newest wins), mirroring the assign route.
    const choreDocs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
      cap: MAX_CHORE_SCAN,
    });
    const settingsByTitle = new Map<
      string,
      { coinValue: number; requireApproval: boolean; createdAt: string }
    >();
    for (const doc of choreDocs) {
      if (readBoolean(doc.fields, "deleted")) {
        continue;
      }
      const key = normalizeStepTitleKey(readString(doc.fields, "title"));
      if (!key) {
        continue;
      }
      const createdAt = readTimestamp(doc.fields, "createdAt") || "";
      const existing = settingsByTitle.get(key);
      if (!existing || createdAt > existing.createdAt) {
        settingsByTitle.set(key, {
          coinValue: normalizeCoinValue(readInteger(doc.fields, "coinValue")),
          requireApproval: readBoolean(doc.fields, "requireApproval"),
          createdAt,
        });
      }
    }

    const config = await loadResponsibilityConfig();
    const now = new Date().toISOString();
    for (const assignment of activeAssignments) {
      await reconcileAssignmentSteps({
        familyId,
        idToken,
        assignment,
        templateSteps: steps,
        routine,
        settingsByTitle,
        routineStepXp: config.xpValues.routineStepXp,
        actor,
        now,
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_SYNC_ASSIGNMENTS_ERROR]", {
      familyId,
      routineId: routine.id,
      reason,
    });
  }
}

const stepSignature = (steps: RoutineAssignmentStep[]) =>
  steps.map((step) => `${step.id} ${step.order} ${step.title}`).join("");

async function reconcileAssignmentSteps(input: {
  familyId: string;
  idToken: string;
  assignment: RoutineAssignment;
  templateSteps: RoutineStep[];
  routine: { id: string; name: string; pillar: ResponsibilityPillar | "" };
  settingsByTitle: Map<string, { coinValue: number; requireApproval: boolean }>;
  routineStepXp: number;
  actor: { uid: string; email: string; name: string };
  now: string;
}): Promise<void> {
  const {
    familyId,
    idToken,
    assignment,
    templateSteps,
    routine,
    settingsByTitle,
    routineStepXp,
    actor,
    now,
  } = input;
  const oldById = new Map(assignment.steps.map((step) => [step.id, step]));
  const newTemplateIds = new Set(templateSteps.map((step) => step.id));
  const stepCount = templateSteps.length;

  // Reconcile by step id: retained steps keep their materialized chore (and its
  // completion state), added steps mint fresh chores, removed steps are dropped.
  const newSteps: RoutineAssignmentStep[] = [];
  const choresToCreate: RoutineAssignmentStep[] = [];
  templateSteps.forEach((tplStep, index) => {
    const order = index + 1;
    const existing = oldById.get(tplStep.id);
    if (existing) {
      newSteps.push({
        ...existing,
        title: tplStep.title,
        order,
        coinValue: tplStep.coinValue ?? existing.coinValue,
        requireApproval: tplStep.requireApproval ?? existing.requireApproval,
      });
      return;
    }
    const matched = settingsByTitle.get(normalizeStepTitleKey(tplStep.title));
    const step: RoutineAssignmentStep = {
      id: tplStep.id,
      title: tplStep.title,
      order,
      choreId: randomUUID(),
      coinValue: tplStep.coinValue ?? matched?.coinValue ?? DEFAULT_CHORE_COIN_VALUE,
      requireApproval: tplStep.requireApproval ?? matched?.requireApproval ?? false,
    };
    newSteps.push(step);
    choresToCreate.push(step);
  });

  const removedSteps = assignment.steps.filter((step) => !newTemplateIds.has(step.id));
  // Nothing structural changed (same ids, order, and titles) — skip the writes.
  if (
    choresToCreate.length === 0 &&
    removedSteps.length === 0 &&
    stepSignature(assignment.steps) === stepSignature(newSteps)
  ) {
    return;
  }

  // Mint chores for added steps.
  await Promise.all(
    choresToCreate.map((step) =>
      createOrReplaceDocument(
        `families/${familyId}/chores/${step.choreId}`,
        routineStepChoreFields({
          step,
          assignmentId: assignment.id,
          routine,
          assigneeId: assignment.assigneeId,
          assigneeName: assignment.assigneeName,
          dueDate: assignment.dueDate,
          stepCount,
          routineStepXp,
          createdByUid: assignment.assignedBy,
          now,
        }),
        idToken,
      ),
    ),
  );

  // Archive chores for removed steps the child has not completed yet. A removed
  // step that was already done stays as the child's completed chore (they did
  // earn it); it simply drops out of the assignment's progress.
  const completedSet = new Set(assignment.completedStepIds);
  await Promise.all(
    removedSteps
      .filter((step) => !completedSet.has(step.id))
      .map((step) =>
        patchDocument(
          `families/${familyId}/chores/${step.choreId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            status: stringField("Archived"),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "status", "updatedAt"],
        ).catch(() => {
          // Chore may have been deleted independently — nothing to archive.
        }),
      ),
  );

  // Refresh retained chores so a renamed/reordered/recosted step is reflected.
  await Promise.all(
    newSteps
      .filter((step) => oldById.has(step.id))
      .map((step) =>
        patchDocument(
          `families/${familyId}/chores/${step.choreId}`,
          {
            title: stringField(step.title),
            coinValue: integerField(step.coinValue),
            requireApproval: boolField(step.requireApproval),
            routineName: stringField(routine.name),
            responsibilityPillar: stringField(routine.pillar),
            routineStepOrder: integerField(step.order),
            routineStepCount: integerField(stepCount),
            updatedAt: timestampField(now),
          },
          idToken,
          [
            "title",
            "coinValue",
            "requireApproval",
            "routineName",
            "responsibilityPillar",
            "routineStepOrder",
            "routineStepCount",
            "updatedAt",
          ],
        ).catch(() => {
          // Chore may have been deleted independently — leave it be.
        }),
      ),
  );

  const remainingCompleted = assignment.completedStepIds.filter((id) =>
    newTemplateIds.has(id),
  );
  const remainingSkipped = assignment.skippedStepIds.filter((id) =>
    newTemplateIds.has(id),
  );
  const reconciled: RoutineAssignment = {
    ...assignment,
    steps: newSteps,
    completedStepIds: remainingCompleted,
    skippedStepIds: remainingSkipped,
  };
  // Removing the last unresolved step can leave the assignment fully complete.
  const completedNow = isAssignmentComplete(reconciled);
  await patchDocument(
    `families/${familyId}/routineAssignments/${assignment.id}`,
    {
      stepsJson: stringField(JSON.stringify(newSteps)),
      completedStepIdsJson: stringField(JSON.stringify(remainingCompleted)),
      skippedStepIdsJson: stringField(JSON.stringify(remainingSkipped)),
      requireApproval: boolField(newSteps.some((step) => step.requireApproval)),
      routineName: stringField(routine.name),
      pillar: stringField(routine.pillar),
      status: stringField(completedNow ? "completed" : "active"),
      updatedAt: timestampField(now),
      ...(completedNow ? { completedAt: timestampField(now) } : {}),
    },
    idToken,
    [
      "stepsJson",
      "completedStepIdsJson",
      "skippedStepIdsJson",
      "requireApproval",
      "routineName",
      "pillar",
      "status",
      "updatedAt",
      ...(completedNow ? ["completedAt"] : []),
    ],
  );

  // If the edit completed the routine and the child actually did some of the
  // work, pay out the completion bonus just as a normal final-step completion
  // would. An assignment completed purely by removing/skipping all of its
  // remaining steps (nothing was ever done) earns nothing.
  if (completedNow && hasAnyCompletedStep(reconciled)) {
    await finalizeRoutineCompletion({
      familyId,
      idToken,
      assignment: reconciled,
      playerUid: assignment.assigneeId,
      actor,
      actorRole: "admin",
      now,
    });
  }
}

function progressSnapshot(
  assignment: RoutineAssignment,
  routineCompleted: boolean,
  completionBonusXpAwarded: number,
  completionBonusCoinsAwarded: number,
): RoutineStepProgressOutcome {
  return {
    assignmentId: assignment.id,
    routineId: assignment.routineId,
    routineName: assignment.routineName,
    pillar: assignment.pillar,
    completedSteps: assignment.completedStepIds.length,
    skippedSteps: assignment.skippedStepIds.length,
    totalSteps: assignment.steps.length,
    routineCompleted,
    completionBonusXpAwarded,
    completionBonusCoinsAwarded,
  };
}
