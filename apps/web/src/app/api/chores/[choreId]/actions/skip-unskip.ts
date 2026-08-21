import {
  getDocument,
  patchDocument,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { runAfterResponse } from "@/lib/async/after-response";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { buildKioskActivityMetadata } from "@/lib/auth/kiosk";
import { getRequesterContext, isRequesterAssignee } from "@/lib/chores/access";
import { resolveAssigneeUid, resolveChoreAssigneeIds } from "@/lib/chores/assignees";
import {
  describeRoutineStepContext,
  emitFamilyActivityBestEffort,
} from "@/lib/chores/activity-helpers";
import { EMPTY_NEW_SKILL_BONUS } from "@/lib/chores/bonus-award";
import {
  recordRoutineStepSkipBestEffort,
  recordRoutineStepUnskipBestEffort,
} from "@/lib/responsibility/assignment-service";
import {
  EMPTY_RESPONSIBILITY_XP,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";

// Skipping is only meaningful for routine-step chores (something the child
// already did, or that does not need doing this time). The step closes out with
// no payout; the routine completion bonus still fires when the routine
// finishes, but only if at least one sibling step was actually completed.
export async function handleSkip(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName } = ctx;
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const routineAssignmentId = readString(existingChoreDoc.fields, "routineAssignmentId");
  if (!routineAssignmentId) {
    return { kind: "not_routine_step" as const };
  }
  if (currentStatus !== "Open") {
    return { kind: "invalid_transition" as const };
  }
  const choreAssigneeIds = await resolveChoreAssigneeIds(familyId, existingChoreDoc.fields, idToken);
  const requesterOwnsChore = choreAssigneeIds.some((id) =>
    isRequesterAssignee(id, session.uid, session.memberId, session.email),
  );
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (!requesterOwnsChore && requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      status: stringField("Skipped"),
      skippedAt: timestampField(now),
      updatedAt: timestampField(now),
    },
    idToken,
    ["status", "skippedAt", "updatedAt"],
  );
  await runAfterResponse("skip-unskip:audit-log", () =>
    writeAuditLogBestEffort({
      familyId,
      idToken,
      eventType: "chore_status_changed",
      actor: { uid: session.uid, email: session.email, name: actorName, role: requester.role },
      userId: choreAssigneeId,
      choreId,
      choreTitle,
      source: readString(existingChoreDoc.fields, "source") || "manual",
      previous: { status: currentStatus },
      next: { status: "Skipped" },
      reason: "skip",
    }),
  );
  const assigneeUid = await resolveAssigneeUid(familyId, choreAssigneeId, idToken);
  const kioskActivity = buildKioskActivityMetadata(session, choreAssigneeId || assigneeUid);
  const routineProgress = await recordRoutineStepSkipBestEffort({
    familyId,
    idToken,
    choreId,
    choreFields: existingChoreDoc.fields,
    playerUid: assigneeUid || "",
    actor: { uid: session.uid, email: session.email, name: actorName },
    actorRole: requester.role,
    kiosk: kioskActivity,
  });
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_skipped",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Routine step skipped",
    message: `${actorName} skipped "${choreTitle}"${describeRoutineStepContext(existingChoreDoc.fields)}.`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
    source: kioskActivity.source,
    authenticatedUid: kioskActivity.authenticatedUid,
    completedForPlayerId: kioskActivity.completedForPlayerId,
  });
  await runAfterResponse("skip-unskip:publish", () =>
    publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now }),
  );
  return {
    kind: "ok" as const,
    syncOwnerUid: "",
    newSkillBonus: EMPTY_NEW_SKILL_BONUS,
    responsibilityXp: EMPTY_RESPONSIBILITY_XP,
    routineProgress,
  };
}

export async function handleUnskip(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName } = ctx;
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreRoutineAssignmentId = readString(existingChoreDoc.fields, "routineAssignmentId");
  const choreAssigneeIds = await resolveChoreAssigneeIds(familyId, existingChoreDoc.fields, idToken);
  // Like skip, un-skipping a routine step is allowed for the assignee (back to
  // open, no payout) as well as any family admin.
  const requesterOwnsChore = choreAssigneeIds.some((id) =>
    isRequesterAssignee(id, session.uid, session.memberId, session.email),
  );
  if (requester.role !== "admin" && !(Boolean(choreRoutineAssignmentId) && requesterOwnsChore)) {
    return { kind: "forbidden_action" as const };
  }
  if (currentStatus !== "Skipped") {
    return { kind: "invalid_transition" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      status: stringField("Open"),
      skippedAt: stringField(""),
      updatedAt: timestampField(now),
    },
    idToken,
    ["status", "skippedAt", "updatedAt"],
  );
  await runAfterResponse("skip-unskip:audit-log", () =>
    writeAuditLogBestEffort({
      familyId,
      idToken,
      eventType: "chore_status_changed",
      actor: { uid: session.uid, email: session.email, name: actorName, role: requester.role },
      userId: choreAssigneeId,
      choreId,
      choreTitle,
      source: readString(existingChoreDoc.fields, "source") || "manual",
      previous: { status: currentStatus },
      next: { status: "Open" },
      reason: "unskip",
    }),
  );
  await recordRoutineStepUnskipBestEffort({
    familyId,
    idToken,
    choreFields: existingChoreDoc.fields,
  });
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_edited",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Routine step restored",
    message: `${actorName} moved "${choreTitle}"${describeRoutineStepContext(existingChoreDoc.fields)} back to open.`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
  });
  await runAfterResponse("skip-unskip:publish", () =>
    publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now }),
  );
  return {
    kind: "ok" as const,
    syncOwnerUid: "",
    newSkillBonus: EMPTY_NEW_SKILL_BONUS,
    responsibilityXp: EMPTY_RESPONSIBILITY_XP,
    routineProgress: null,
  };
}
