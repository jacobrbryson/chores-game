import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listAllDocuments,
  patchDocument,
  readBoolean,
  readString,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { type ChoreRecurrenceConfig, nextRecurringDueDate } from "@/lib/chores/recurrence";
import { canonicalRecurringChoreId } from "@/lib/chores/skill-bonus";
import { readOptionalSortOrder } from "@/lib/chores/input";

// Safety cap when paging the full chores collection (recurring chores grow it
// without bound). Mirrors MAX_CHORE_ARCHIVE in the chores list route.
const MAX_CHORE_SCAN = 5000;

export function datePartFromTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function nextOpenSortOrder(docs: Awaited<ReturnType<typeof listAllDocuments>>) {
  return (
    docs
      .filter(
        (doc) =>
          !readBoolean(doc.fields, "deleted") && readString(doc.fields, "status") === "Open",
      )
      .reduce((maxValue, doc) => {
        const value = readOptionalSortOrder(doc.fields);
        return typeof value === "number" ? Math.max(maxValue, value) : maxValue;
      }, -1) + 1
  );
}

// When a completed recurring chore is edited, propagate the edit onto its
// already-spawned future occurrence (or create one if none exists yet) so the
// next copy reflects the new title/assignee/coins/etc.
export async function syncFutureRecurringChoreAfterCompletedEdit(input: {
  familyId: string;
  idToken: string;
  choreId: string;
  existingFields: Record<string, FirestoreValue> | undefined;
  recurrence: ChoreRecurrenceConfig;
  title: string;
  choreType: string;
  assigneeId: string;
  assigneeIds: string[];
  assigneeScope: string;
  assigneeName: string;
  details: string;
  categoryIds: string[];
  coinValue: number;
  requireApproval: boolean;
  newSkillEnabled: boolean;
  responsibilityPillar: string;
  fallbackDueDate: string;
  actorUid: string;
  now: string;
}) {
  if (input.recurrence.recurrenceType === "none") {
    return;
  }
  const completionDate =
    datePartFromTimestamp(readTimestamp(input.existingFields, "submittedAt")) ||
    datePartFromTimestamp(readTimestamp(input.existingFields, "updatedAt")) ||
    input.fallbackDueDate ||
    input.now.slice(0, 10);
  const nextDueDate = nextRecurringDueDate(
    completionDate,
    input.recurrence,
    input.fallbackDueDate || completionDate,
  );
  const rootChoreId = canonicalRecurringChoreId(input.existingFields, input.choreId);
  const allChoreDocs = await listAllDocuments(`families/${input.familyId}/chores`, input.idToken, {
    cap: MAX_CHORE_SCAN,
  });
  const futureChore = allChoreDocs
    .filter((doc) => {
      const docId = documentIdFromName(doc.name);
      if (docId === input.choreId || readBoolean(doc.fields, "deleted")) {
        return false;
      }
      if (readString(doc.fields, "status") !== "Open") {
        return false;
      }
      const parentId = readString(doc.fields, "recurrenceParentChoreId");
      const docRootId = readString(doc.fields, "recurrenceRootChoreId");
      return parentId === input.choreId || (rootChoreId && docRootId === rootChoreId);
    })
    .sort((a, b) => {
      const aDueDate = readString(a.fields, "dueDate");
      const bDueDate = readString(b.fields, "dueDate");
      return aDueDate.localeCompare(bDueDate);
    })[0];
  const syncedFields = {
    title: stringField(input.title),
    choreType: stringField(input.choreType),
    assigneeId: stringField(input.assigneeId),
    assigneeIds: stringArrayField(input.assigneeIds),
    assigneeScope: stringField(input.assigneeScope),
    assigneeName: stringField(input.assigneeName),
    details: stringField(input.details),
    categoryIds: stringArrayField(input.categoryIds),
    dueDate: stringField(nextDueDate),
    coinValue: integerField(input.coinValue),
    requireApproval: boolField(input.requireApproval),
    newSkillEnabled: boolField(input.newSkillEnabled),
    recurrenceType: stringField(input.recurrence.recurrenceType),
    recurrenceInterval: integerField(input.recurrence.recurrenceInterval ?? 0),
    recurrenceUnit: stringField(input.recurrence.recurrenceUnit ?? ""),
    recurrenceDays: stringArrayField(input.recurrence.recurrenceDays ?? []),
    recurrenceParentChoreId: stringField(input.choreId),
    recurrenceRootChoreId: stringField(rootChoreId),
    responsibilityPillar: stringField(input.responsibilityPillar),
    updatedAt: timestampField(input.now),
  };
  if (futureChore) {
    await patchDocument(
      `families/${input.familyId}/chores/${documentIdFromName(futureChore.name)}`,
      syncedFields,
      input.idToken,
      [
        "title",
        "choreType",
        "assigneeId",
        "assigneeIds",
        "assigneeScope",
        "assigneeName",
        "details",
        "categoryIds",
        "dueDate",
        "coinValue",
        "requireApproval",
        "newSkillEnabled",
        "recurrenceType",
        "recurrenceInterval",
        "recurrenceUnit",
        "recurrenceDays",
        "recurrenceParentChoreId",
        "recurrenceRootChoreId",
        "responsibilityPillar",
        "updatedAt",
      ],
    );
    return;
  }
  await createOrReplaceDocument(
    `families/${input.familyId}/chores/${randomUUID()}`,
    {
      ...syncedFields,
      status: stringField("Open"),
      deleted: boolField(false),
      createdBy: stringField(input.actorUid),
      createdAt: timestampField(input.now),
      sortOrder: integerField(nextOpenSortOrder(allChoreDocs)),
      source: stringField("manual"),
    },
    input.idToken,
  );
}

export type RemoveSpawnedResult = { kind: "ok" } | { kind: "recurring_successor_locked" };

// Removes the auto-spawned next occurrence of a recurring chore when its
// completion is undone, but only while that successor is still untouched (Open).
export async function removeSpawnedRecurringChoreIfPossible(
  familyId: string,
  spawnedNextChoreId: string,
  idToken: string,
  now: string,
): Promise<RemoveSpawnedResult> {
  if (!spawnedNextChoreId) {
    return { kind: "ok" as const };
  }
  const spawnedDoc = await getDocument(
    `families/${familyId}/chores/${spawnedNextChoreId}`,
    idToken,
  );
  if (readBoolean(spawnedDoc.fields, "deleted")) {
    return { kind: "ok" as const };
  }
  const status = readString(spawnedDoc.fields, "status") || "Open";
  if (status !== "Open") {
    return { kind: "recurring_successor_locked" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${spawnedNextChoreId}`,
    {
      deleted: boolField(true),
      deletedAt: timestampField(now),
      status: stringField("Deleted"),
      updatedAt: timestampField(now),
    },
    idToken,
    ["deleted", "deletedAt", "status", "updatedAt"],
  );
  return { kind: "ok" as const };
}
