import {
  boolField,
  getDocument,
  integerField,
  patchDocument,
  readString,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { GOOGLE_TASKS_CHORE_SOURCE } from "@/lib/google/tasks-sync";
import { DEFAULT_CHORE_COIN_VALUE, recurrenceLabel } from "@/lib/chores/recurrence";
import { normalizeChoreType } from "@/lib/chores/types";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import {
  buildCategoryMap,
  hasAllCategoryIds,
  listFamilyCategories,
  readChoreCategoryIds,
} from "@/lib/family/categories";
import { reassignRoutineAssignmentBestEffort } from "@/lib/responsibility/assignment-service";
import { getRequesterContext, isRequesterAssignee } from "@/lib/chores/access";
import { countActiveChoresForAssignee, getFamilyMemberName } from "@/lib/chores/assignees";
import { resolveStoredNewSkillEnabled } from "@/lib/chores/input";
import { emitFamilyActivityBestEffort } from "@/lib/chores/activity-helpers";
import { syncFutureRecurringChoreAfterCompletedEdit } from "@/lib/chores/recurring-edit";
import { EMPTY_NEW_SKILL_BONUS } from "@/lib/chores/bonus-award";
import {
  EMPTY_RESPONSIBILITY_XP,
  MAX_ACTIVE_CHORES_PER_ASSIGNEE,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";

function okOutcome(syncOwnerUid: string): ChoreActionOutcome {
  return {
    kind: "ok" as const,
    syncOwnerUid,
    newSkillBonus: EMPTY_NEW_SKILL_BONUS,
    responsibilityXp: EMPTY_RESPONSIBILITY_XP,
    routineProgress: null,
  };
}

export async function handleSetCategories(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName, categoryIds } = ctx;
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const categories = await listFamilyCategories(familyId, idToken);
  const categoryMap = buildCategoryMap(categories);
  if (!hasAllCategoryIds(categoryIds, categoryMap)) {
    return { kind: "invalid_category_ids" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      categoryIds: stringArrayField(categoryIds),
      updatedAt: timestampField(now),
    },
    idToken,
    ["categoryIds", "updatedAt"],
  );
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_edited",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Chore categories updated",
    message: `${actorName} updated categories for "${choreTitle}".`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
  });
  await publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now });
  return okOutcome("");
}

export async function handleEdit(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const {
    familyId,
    idToken,
    session,
    choreId,
    now,
    actorName,
    normalizedDescription,
    dueDate,
    details,
    coinValue,
    requireApproval,
    newSkillEnabled,
    recurrence,
    hasCategoryIds,
    categoryIds,
    hasResponsibilityPillar,
    responsibilityPillar,
    resolvedAssigneeIds,
    resolvedAssigneeScope,
    resolvedSingleAssigneeId,
  } = ctx;
  let syncOwnerUid = "";
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const previousAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const previousTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  // Routine steps are single-assignee by model. Changing one step's assignee
  // moves the whole routine (handled after the patch below), so a
  // family/multiple scope on a routine step is not allowed.
  const editChoreRoutineAssignmentId = readString(existingChoreDoc.fields, "routineAssignmentId");
  if (editChoreRoutineAssignmentId && resolvedAssigneeScope !== "single") {
    return { kind: "routine_step_single_assignee_only" as const };
  }
  const choreSource = readString(existingChoreDoc.fields, "source");
  const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
  const existingCategoryIds = readChoreCategoryIds(existingChoreDoc.fields);
  const categories = await listFamilyCategories(familyId, idToken);
  const categoryMap = buildCategoryMap(categories);
  const nextCategoryIds = hasCategoryIds ? categoryIds : existingCategoryIds;
  if (!hasAllCategoryIds(nextCategoryIds, categoryMap)) {
    return { kind: "invalid_category_ids" as const };
  }
  if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
    syncOwnerUid = choreGoogleTaskOwnerUid;
  } else if (
    isRequesterAssignee(previousAssigneeId, session.uid, session.memberId, session.email) ||
    isRequesterAssignee(resolvedSingleAssigneeId, session.uid, session.memberId, session.email)
  ) {
    syncOwnerUid = session.uid;
  }
  if (resolvedSingleAssigneeId) {
    const activeChoreCount = await countActiveChoresForAssignee(
      familyId,
      resolvedSingleAssigneeId,
      idToken,
      choreId,
    );
    if (activeChoreCount >= MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
      return { kind: "active_chore_limit_reached" as const };
    }
  }
  const resolvedAssigneeName =
    resolvedAssigneeScope === "family"
      ? "Family"
      : resolvedAssigneeIds.length > 1
        ? `${resolvedAssigneeIds.length} assignees`
        : resolvedSingleAssigneeId
          ? await getFamilyMemberName(familyId, resolvedSingleAssigneeId, idToken)
          : "Unassigned";
  const nextChoreType =
    resolvedAssigneeScope === "family" || resolvedAssigneeIds.length > 1
      ? "group"
      : normalizeChoreType(readString(existingChoreDoc.fields, "choreType"), "normal");
  const resolvedCoinValue = coinValue ?? DEFAULT_CHORE_COIN_VALUE;
  const resolvedRequireApproval =
    nextChoreType === "see_and_do" ||
    resolvedAssigneeScope === "family" ||
    resolvedAssigneeIds.length > 1
      ? true
      : requireApproval;
  const resolvedNewSkillEnabled =
    nextChoreType === "see_and_do"
      ? false
      : newSkillEnabled ?? resolveStoredNewSkillEnabled(existingChoreDoc.fields);
  const resolvedResponsibilityPillar = hasResponsibilityPillar
    ? responsibilityPillar
    : normalizeResponsibilityPillar(readString(existingChoreDoc.fields, "responsibilityPillar"));
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      title: stringField(normalizedDescription),
      choreType: stringField(nextChoreType),
      assigneeId: stringField(resolvedSingleAssigneeId),
      assigneeIds: stringArrayField(resolvedAssigneeIds),
      assigneeScope: stringField(resolvedAssigneeScope),
      assigneeName: stringField(resolvedAssigneeName),
      dueDate: stringField(dueDate),
      details: stringField(details),
      categoryIds: stringArrayField(nextCategoryIds),
      coinValue: integerField(resolvedCoinValue),
      requireApproval: boolField(resolvedRequireApproval),
      newSkillEnabled: boolField(resolvedNewSkillEnabled),
      recurrenceType: stringField(recurrence.recurrenceType),
      recurrenceInterval: integerField(recurrence.recurrenceInterval ?? 0),
      recurrenceUnit: stringField(recurrence.recurrenceUnit ?? ""),
      recurrenceDays: stringArrayField(recurrence.recurrenceDays ?? []),
      responsibilityPillar: stringField(resolvedResponsibilityPillar),
      updatedAt: timestampField(now),
    },
    idToken,
    [
      "title",
      "choreType",
      "assigneeId",
      "assigneeIds",
      "assigneeScope",
      "assigneeName",
      "dueDate",
      "details",
      "categoryIds",
      "coinValue",
      "requireApproval",
      "newSkillEnabled",
      "recurrenceType",
      "recurrenceInterval",
      "recurrenceUnit",
      "recurrenceDays",
      "responsibilityPillar",
      "updatedAt",
    ],
  );
  if (
    (currentStatus === "Submitted" || currentStatus === "Approved") &&
    recurrence.recurrenceType !== "none" &&
    !editChoreRoutineAssignmentId
  ) {
    await syncFutureRecurringChoreAfterCompletedEdit({
      familyId,
      idToken,
      choreId,
      existingFields: existingChoreDoc.fields,
      recurrence,
      title: normalizedDescription,
      choreType: nextChoreType,
      assigneeId: resolvedSingleAssigneeId,
      assigneeIds: resolvedAssigneeIds,
      assigneeScope: resolvedAssigneeScope,
      assigneeName: resolvedAssigneeName,
      details,
      categoryIds: nextCategoryIds,
      coinValue: resolvedCoinValue,
      requireApproval: resolvedRequireApproval,
      newSkillEnabled: resolvedNewSkillEnabled,
      responsibilityPillar: resolvedResponsibilityPillar,
      fallbackDueDate: dueDate,
      actorUid: session.uid,
      now,
    });
  }
  // Changing a routine step's assignee moves the entire routine to the new
  // child: every still-open step chore and the assignment record follow, so the
  // routine never ends up split across kids.
  if (
    editChoreRoutineAssignmentId &&
    resolvedSingleAssigneeId &&
    resolvedSingleAssigneeId !== previousAssigneeId
  ) {
    await reassignRoutineAssignmentBestEffort({
      familyId,
      idToken,
      assignmentId: editChoreRoutineAssignmentId,
      assigneeId: resolvedSingleAssigneeId,
      assigneeName: resolvedAssigneeName,
      excludeChoreId: choreId,
      actor: { uid: session.uid, email: session.email, name: actorName },
    });
  }
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_edited",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Chore updated",
    message: `${actorName} updated "${normalizedDescription || previousTitle}" (${resolvedCoinValue} coins${resolvedRequireApproval ? ", approval required" : ""}${recurrence.recurrenceType !== "none" ? `, ${recurrenceLabel(recurrence).toLowerCase()}` : ""}).`,
    choreId,
    choreTitle: normalizedDescription || previousTitle,
    relatedIds: Array.from(new Set([...resolvedAssigneeIds, previousAssigneeId].filter(Boolean))),
  });
  await publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now });
  return okOutcome(syncOwnerUid);
}
