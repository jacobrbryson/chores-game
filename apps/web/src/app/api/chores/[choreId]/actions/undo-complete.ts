import {
  getDocument,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { GOOGLE_TASKS_CHORE_SOURCE } from "@/lib/google/tasks-sync";
import { normalizeCoinValue } from "@/lib/chores/recurrence";
import { recordRoutineStepUndoBestEffort } from "@/lib/responsibility/assignment-service";
import { getRequesterContext, isRequesterAssignee } from "@/lib/chores/access";
import { listActiveFamilyMemberIds } from "@/lib/chores/assignees";
import { applyPayoutByAssignee, buildPayoutByAssignee } from "@/lib/chores/payouts";
import { EMPTY_NEW_SKILL_BONUS } from "@/lib/chores/bonus-award";
import { emitFamilyActivityBestEffort } from "@/lib/chores/activity-helpers";
import { removeSpawnedRecurringChoreIfPossible } from "@/lib/chores/recurring-edit";
import {
  EMPTY_RESPONSIBILITY_XP,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";

export async function handleUndoComplete(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName } = ctx;
  let syncOwnerUid = "";
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreAssigneeIdsRaw = readStringArray(existingChoreDoc.fields, "assigneeIds");
  const choreAssigneeScope = readString(existingChoreDoc.fields, "assigneeScope");
  const choreRoutineAssignmentId = readString(existingChoreDoc.fields, "routineAssignmentId");
  const choreAssigneeIds =
    choreAssigneeScope === "family"
      ? await listActiveFamilyMemberIds(familyId, idToken)
      : choreAssigneeIdsRaw.length > 0
        ? choreAssigneeIdsRaw
        : choreAssigneeId
          ? [choreAssigneeId]
          : [];
  // Undo is an admin action for ordinary chores, but the assignee may undo their
  // own routine step from the routine progress dialog (the wallet ledger keeps
  // the coin clawback idempotent and non-negative).
  const requesterOwnsChore = choreAssigneeIds.some((id) =>
    isRequesterAssignee(id, session.uid, session.memberId, session.email),
  );
  if (requester.role !== "admin" && !(Boolean(choreRoutineAssignmentId) && requesterOwnsChore)) {
    return { kind: "forbidden_action" as const };
  }
  const choreSource = readString(existingChoreDoc.fields, "source");
  const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
  const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
  const spawnedNextChoreId = readString(existingChoreDoc.fields, "spawnedNextChoreId");
  if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
    syncOwnerUid = choreGoogleTaskOwnerUid;
  } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)) {
    syncOwnerUid = session.uid;
  }
  if (
    currentStatus !== "Submitted" &&
    currentStatus !== "Approved" &&
    currentStatus !== "Rejected"
  ) {
    return { kind: "invalid_transition" as const };
  }
  const removeSpawnedResult = await removeSpawnedRecurringChoreIfPossible(
    familyId,
    spawnedNextChoreId,
    idToken,
    now,
  );
  if (removeSpawnedResult.kind === "recurring_successor_locked") {
    return { kind: "recurring_successor_locked" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      status: stringField("Open"),
      updatedAt: timestampField(now),
      spawnedNextChoreId: stringField(""),
      rejectionFeedback: stringField(""),
      approvalPayoutsJson: stringField(""),
    },
    idToken,
    ["status", "updatedAt", "spawnedNextChoreId", "rejectionFeedback", "approvalPayoutsJson"],
  );
  await writeAuditLogBestEffort({
    familyId,
    idToken,
    eventType: "chore_status_changed",
    actor: { uid: session.uid, email: session.email, name: actorName, role: requester.role },
    userId: choreAssigneeId,
    choreId,
    choreTitle,
    source: choreSource || "manual",
    previous: {
      status: currentStatus,
      spawnedNextChoreId,
      approvalPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
    },
    next: { status: "Open", spawnedNextChoreId: "" },
    reason: "undo_complete",
  });
  const payoutByAssignee = buildPayoutByAssignee({
    assigneeIds: choreAssigneeIds,
    totalCoinValue: choreCoinValue,
    storedPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
  });
  if (currentStatus === "Approved") {
    const payoutResult = await applyPayoutByAssignee({
      familyId,
      idToken,
      choreId,
      payoutByAssignee,
      direction: "debit",
      actorUid: session.uid,
      actorRole: requester.role,
      choreStatus: currentStatus,
    });
    if (payoutResult.kind === "wallet_negative_blocked") {
      return { kind: "wallet_negative_blocked" as const };
    }
    if (payoutResult.kind === "wallet_permission_denied") {
      return { kind: "wallet_permission_denied" as const };
    }
    // Undoing a paid routine step re-opens it inside its assignment (an
    // already-paid routine completion bonus is not clawed back — the wallet
    // ledger keeps it from ever double-paying).
    await recordRoutineStepUndoBestEffort({
      familyId,
      idToken,
      choreFields: existingChoreDoc.fields,
    });
  }
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_undo_completed",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Completion undone",
    message: `${actorName} moved "${choreTitle}" back to open.${spawnedNextChoreId ? " The next recurring copy was removed." : ""}`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
  });
  await publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now });
  return {
    kind: "ok" as const,
    syncOwnerUid,
    newSkillBonus: EMPTY_NEW_SKILL_BONUS,
    responsibilityXp: EMPTY_RESPONSIBILITY_XP,
    routineProgress: null,
  };
}
