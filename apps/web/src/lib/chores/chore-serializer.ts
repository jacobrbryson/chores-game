import {
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { GOOGLE_TASKS_CHORE_SOURCE } from "@/lib/google/tasks-sync";
import { normalizeChoreType } from "@/lib/chores/types";
import { normalizeRecurrenceConfig, normalizeCoinValue } from "@/lib/chores/recurrence";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import {
  buildCategoryMap,
  readChoreCategoryIds,
  resolveChoreCategories,
} from "@/lib/family/categories";
import {
  resolveAssigneeAvatarId,
  resolveAssigneeAvatarPhotoUrl,
  resolveAssigneePrimaryColor,
} from "@/lib/chores/assignees";
import { readOptionalSortOrder, resolveStoredNewSkillEnabled } from "@/lib/chores/input";

// Builds the detailed single-chore payload returned by GET /api/chores/[choreId].
// Resolves the assignee presentation fields and the chore's categories.
export async function buildChoreDetailPayload(params: {
  choreId: string;
  fields: Record<string, FirestoreValue> | undefined;
  categoryMap: ReturnType<typeof buildCategoryMap>;
  familyId: string;
  idToken: string;
}) {
  const { choreId, fields, categoryMap, familyId, idToken } = params;
  const status = readString(fields, "status") || "Open";
  const assigneeId = readString(fields, "assigneeId");
  const categoryIds = readChoreCategoryIds(fields);
  return {
    id: choreId,
    title: readString(fields, "title") || "Untitled chore",
    choreType: normalizeChoreType(
      readString(fields, "choreType"),
      readString(fields, "assigneeScope") === "family" ||
        readStringArray(fields, "assigneeIds").length > 1
        ? "group"
        : "normal",
    ),
    status,
    source:
      readString(fields, "source") === GOOGLE_TASKS_CHORE_SOURCE ? "google_tasks" : "manual",
    sortOrder: readOptionalSortOrder(fields),
    assigneeId: assigneeId || undefined,
    assigneeIds: readStringArray(fields, "assigneeIds"),
    assigneeScope:
      readString(fields, "assigneeScope") === "family"
        ? "family"
        : readString(fields, "assigneeScope") === "multiple"
          ? "multiple"
          : "single",
    assigneeName: readString(fields, "assigneeName") || "Unassigned",
    assigneePrimaryColor: await resolveAssigneePrimaryColor(familyId, assigneeId, idToken),
    assigneeAvatarId: await resolveAssigneeAvatarId(familyId, assigneeId, idToken),
    assigneeAvatarPhotoUrl: await resolveAssigneeAvatarPhotoUrl(familyId, assigneeId, idToken),
    details: readString(fields, "details") || undefined,
    actionHref: readString(fields, "actionHref") || undefined,
    actionLabel: readString(fields, "actionLabel") || undefined,
    dueDate: readString(fields, "dueDate"),
    categoryIds,
    categories: resolveChoreCategories(categoryIds, categoryMap),
    completedAt:
      status === "Submitted" || status === "Approved"
        ? readTimestamp(fields, "submittedAt") || readTimestamp(fields, "updatedAt") || undefined
        : undefined,
    coinValue: normalizeCoinValue(readInteger(fields, "coinValue")),
    requireApproval: readBoolean(fields, "requireApproval"),
    recurrenceType: normalizeRecurrenceConfig({
      recurrenceType: readString(fields, "recurrenceType"),
      recurrenceInterval: readInteger(fields, "recurrenceInterval"),
      recurrenceUnit: readString(fields, "recurrenceUnit"),
      recurrenceDays: readStringArray(fields, "recurrenceDays"),
    }).recurrenceType,
    recurrenceInterval: readInteger(fields, "recurrenceInterval") || undefined,
    recurrenceUnit: readString(fields, "recurrenceUnit") || undefined,
    recurrenceDays: readStringArray(fields, "recurrenceDays"),
    responsibilityPillar:
      normalizeResponsibilityPillar(readString(fields, "responsibilityPillar")) || undefined,
    // The chore list endpoint already returns this; the detail endpoint needs it
    // too so the mobile edit sheet can hydrate the New Skill Bonus checkbox
    // instead of falling back to the "enabled" default.
    newSkillEnabled: resolveStoredNewSkillEnabled(fields),
    routineAssignmentId: readString(fields, "routineAssignmentId") || undefined,
    routineId: readString(fields, "routineId") || undefined,
    routineName: readString(fields, "routineName") || undefined,
    routineStepOrder: readInteger(fields, "routineStepOrder") || undefined,
    routineStepCount: readInteger(fields, "routineStepCount") || undefined,
    createdAt: readTimestamp(fields, "createdAt") || undefined,
  };
}
