import {
  boolField,
  getDocument,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import type { SessionUser } from "@/lib/auth/session";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { runAfterResponse } from "@/lib/async/after-response";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { GOOGLE_TASKS_CHORE_SOURCE } from "@/lib/google/tasks-sync";
import { normalizeCoinValue } from "@/lib/chores/recurrence";
import { getRequesterContext, isRequesterAssignee } from "@/lib/chores/access";
import { resolveChoreAssigneeIds } from "@/lib/chores/assignees";
import { applyPayoutByAssignee, buildPayoutByAssignee } from "@/lib/chores/payouts";
import {
  emitFamilyActivityBestEffort,
  syncGoogleTasksBestEffort,
} from "@/lib/chores/activity-helpers";

export type DeleteChoreOutcome =
  | { kind: "ok" }
  | { kind: "forbidden_action" }
  | { kind: "wallet_negative_blocked" }
  | { kind: "wallet_permission_denied" };

// Soft-deletes a chore: marks it deleted, claws back coins for an already-paid
// (Approved) chore, emits activity, and re-syncs Google Tasks for the owner.
export async function handleDelete(params: {
  familyId: string;
  idToken: string;
  session: SessionUser;
  choreId: string;
}): Promise<DeleteChoreOutcome> {
  const { familyId, idToken, session, choreId } = params;
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }

  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreAssigneeIds = await resolveChoreAssigneeIds(familyId, existingChoreDoc.fields, idToken);
  const choreSource = readString(existingChoreDoc.fields, "source");
  const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
  const now = new Date().toISOString();
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      deleted: boolField(true),
      deletedAt: timestampField(now),
      status: stringField("Deleted"),
      updatedAt: timestampField(now),
    },
    idToken,
    ["deleted", "deletedAt", "status", "updatedAt"],
  );
  await runAfterResponse("delete:audit-log", () =>
    writeAuditLogBestEffort({
      familyId,
      idToken,
      eventType: "chore_status_changed",
      actor: {
        uid: session.uid,
        email: session.email,
        name: session.name || session.email,
        role: requester.role,
      },
      userId: choreAssigneeId,
      choreId,
      choreTitle,
      source: choreSource || "manual",
      previous: { status: currentStatus, deleted: readBoolean(existingChoreDoc.fields, "deleted") },
      next: { status: "Deleted", deleted: true },
      reason: "delete",
    }),
  );
  if (currentStatus === "Approved") {
    const payoutByAssignee = buildPayoutByAssignee({
      assigneeIds: choreAssigneeIds,
      totalCoinValue: choreCoinValue,
      storedPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
    });
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
  }
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_deleted",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName: session.name || session.email,
    title: "Chore deleted",
    message: `${session.name || "Someone"} deleted "${choreTitle}".`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
  });
  await runAfterResponse("delete:publish", () =>
    publishFamilyActivity({ type: "chore_deleted", familyId, choreId, occurredAt: now }),
  );
  // Mirrors the deletion back to Google Tasks. `force` stays — that is the point
  // of the call — but the external round trip runs after the response.
  const googleTasksSyncUid =
    choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid
      ? choreGoogleTaskOwnerUid
      : isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)
        ? session.uid
        : "";
  if (googleTasksSyncUid) {
    await runAfterResponse("delete:google-tasks-sync", () =>
      syncGoogleTasksBestEffort({
        uid: googleTasksSyncUid,
        idToken,
        force: true,
        minIntervalSeconds: 0,
      }),
    );
  }

  return { kind: "ok" as const };
}
