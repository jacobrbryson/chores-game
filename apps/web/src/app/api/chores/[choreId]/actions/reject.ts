import {
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { runAfterResponse } from "@/lib/async/after-response";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { getRequesterContext } from "@/lib/chores/access";
import {
  resolveAssigneeUid,
  resolveChoreAssigneeIds,
  userHasFamilyMembership,
} from "@/lib/chores/assignees";
import {
  emitFamilyActivityBestEffort,
  trackAchievementEventBestEffort,
} from "@/lib/chores/activity-helpers";
import {
  EMPTY_RESPONSIBILITY_XP,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";
import { EMPTY_NEW_SKILL_BONUS } from "@/lib/chores/bonus-award";

export async function handleReject(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName, feedback } = ctx;
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
  if (currentStatus !== "Submitted" || !choreRequireApproval) {
    return { kind: "invalid_transition" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      status: stringField("Rejected"),
      rejectionFeedback: stringField(feedback),
      updatedAt: timestampField(now),
    },
    idToken,
    ["status", "rejectionFeedback", "updatedAt"],
  );
  await runAfterResponse("reject:audit-log", () =>
    writeAuditLogBestEffort({
      familyId,
      idToken,
      eventType: "chore_status_changed",
      actor: {
        uid: session.uid,
        email: session.email,
        name: actorName,
        role: requester.role,
      },
      userId: choreAssigneeId,
      choreId,
      choreTitle,
      source: readString(existingChoreDoc.fields, "source") || "manual",
      previous: { status: currentStatus },
      next: { status: "Rejected", rejectionFeedback: feedback },
      reason: "reject",
    }),
  );
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_rejected",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Chore rejected",
    message: feedback
      ? `${actorName} rejected "${choreTitle}": ${feedback}`
      : `${actorName} rejected "${choreTitle}".`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
  });
  await runAfterResponse("reject:publish-chore-updated", () =>
    publishFamilyActivity({
      type: "chore_updated",
      familyId,
      choreId,
      occurredAt: now,
    }),
  );
  await runAfterResponse("reject:achievements", async () => {
    try {
      // Flag a pending rejection for every assignee (group/family/multi-assignee
      // chores store an empty singular assigneeId), mirroring the completion and
      // approval paths so Bounce Back can fire for them too.
      const choreAssigneeIds = await resolveChoreAssigneeIds(
        familyId,
        existingChoreDoc.fields,
        idToken,
      );
      const flaggedRejectionUids = new Set<string>();
      for (const assigneeAlias of choreAssigneeIds) {
        const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
        if (!assigneeUid || flaggedRejectionUids.has(assigneeUid)) {
          continue;
        }
        const canTrack = await userHasFamilyMembership(assigneeUid, familyId, idToken);
        if (!canTrack) {
          continue;
        }
        flaggedRejectionUids.add(assigneeUid);
        await trackAchievementEventBestEffort({
          uid: assigneeUid,
          familyId,
          idToken,
          viewerRole: "player",
          eventId: `chore_reject_${choreId}_${assigneeUid}`,
          rejectionFlagSet: true,
          approvalStreakDelta: "reset",
        });
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
      console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
    }
  });
  return {
    kind: "ok" as const,
    syncOwnerUid: "",
    newSkillBonus: EMPTY_NEW_SKILL_BONUS,
    responsibilityXp: EMPTY_RESPONSIBILITY_XP,
    routineProgress: null,
  };
}
