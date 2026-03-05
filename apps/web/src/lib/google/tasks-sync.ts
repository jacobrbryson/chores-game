import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readTimestamp,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  createGoogleTask,
  deleteGoogleTask,
  GoogleTasksHttpError,
  listGoogleTasks,
  patchGoogleTask,
} from "@/lib/google/tasks-api";
import {
  resolveGoogleTaskListsForUser,
  updateGoogleTasksSyncMetadata,
} from "@/lib/google/tasks-link";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";

export const GOOGLE_TASKS_CHORE_SOURCE = "google_tasks";

const DEFAULT_CHORE_COINS_FOR_IMPORTED_GOOGLE_TASKS = 0;
const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;
const LOCAL_REMOTE_AUTHORITY_TOLERANCE_MILLIS = 1000;
const DEFAULT_MIN_SYNC_INTERVAL_SECONDS = 60;

type LocalChore = {
  id: string;
  title: string;
  details: string;
  dueDate: string;
  status: string;
  deleted: boolean;
  assigneeId: string;
  assigneeName: string;
  createdAt: string;
  submittedAt: string;
  updatedAt: string;
  sortOrder?: number;
  source: string;
  googleTaskId: string;
  googleTaskListId: string;
  googleTaskOwnerUid: string;
};

type SyncGoogleTasksOptions = {
  uid: string;
  idToken: string;
  force?: boolean;
  minIntervalSeconds?: number;
  throwOnError?: boolean;
};

export type SyncGoogleTasksResult = {
  kind: "ok" | "skipped" | "error";
  reason?: string;
  importedCount: number;
  updatedCount: number;
  deletedCount: number;
  pushedCount: number;
};

function toUnixMillis(value: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toIsoDateOrToday(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 160);
  return normalized || "Untitled task";
}

function normalizeDetails(value: string) {
  return value.trim().slice(0, 2000);
}

function readOptionalSortOrder(fields: Record<string, FirestoreValue> | undefined) {
  const value = fields?.sortOrder;
  if (!value) {
    return undefined;
  }
  const raw =
    "integerValue" in value
      ? value.integerValue
      : "stringValue" in value
        ? value.stringValue
        : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return undefined;
  }
  return normalized;
}

function compareBySortOrderOrOldest(a: LocalChore, b: LocalChore) {
  const aHasSortOrder = typeof a.sortOrder === "number";
  const bHasSortOrder = typeof b.sortOrder === "number";
  const aSortOrder = aHasSortOrder ? (a.sortOrder as number) : -1;
  const bSortOrder = bHasSortOrder ? (b.sortOrder as number) : -1;
  if (aHasSortOrder && bHasSortOrder && aSortOrder !== bSortOrder) {
    return aSortOrder - bSortOrder;
  }
  if (aHasSortOrder && !bHasSortOrder) {
    return -1;
  }
  if (!aHasSortOrder && bHasSortOrder) {
    return 1;
  }
  const createdDiff = toUnixMillis(a.createdAt) - toUnixMillis(b.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return a.id.localeCompare(b.id);
}

function googleDueToDueDate(value: string | undefined) {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function dueDateToGoogleDue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  return `${value}T00:00:00.000Z`;
}

function isFutureDueDate(value: string, todayIsoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return value > todayIsoDate;
}

function isCompletedStatus(value: string) {
  return value === "Submitted" || value === "Approved";
}

function localAuthorityMillis(chore: LocalChore) {
  return toUnixMillis(chore.updatedAt) || toUnixMillis(chore.submittedAt) || toUnixMillis(chore.createdAt);
}

function parseLocalChore(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): LocalChore {
  return {
    id: documentIdFromName(doc.name),
    title: readString(doc.fields, "title"),
    details: readString(doc.fields, "details"),
    dueDate: readString(doc.fields, "dueDate"),
    status: readString(doc.fields, "status"),
    deleted: readBoolean(doc.fields, "deleted"),
    assigneeId: readString(doc.fields, "assigneeId"),
    assigneeName: readString(doc.fields, "assigneeName"),
    createdAt: readTimestamp(doc.fields, "createdAt") || "",
    submittedAt: readTimestamp(doc.fields, "submittedAt") || "",
    updatedAt: readTimestamp(doc.fields, "updatedAt") || "",
    sortOrder: readOptionalSortOrder(doc.fields),
    source: readString(doc.fields, "source"),
    googleTaskId: readString(doc.fields, "googleTaskId"),
    googleTaskListId: readString(doc.fields, "googleTaskListId"),
    googleTaskOwnerUid: readString(doc.fields, "googleTaskOwnerUid"),
  };
}

async function resolveAssigneeName(familyId: string, uid: string, idToken: string, fallbackName: string) {
  try {
    const directMemberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    const directName = readString(directMemberDoc.fields, "name");
    if (directName) {
      return directName;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const byUid = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    return readString(doc.fields, "uid") === uid;
  });
  if (byUid) {
    const name = readString(byUid.fields, "name");
    if (name) {
      return name;
    }
  }
  return fallbackName || "Unassigned";
}

function isGoogleTaskNotFound(error: unknown) {
  if (!(error instanceof GoogleTasksHttpError)) {
    return false;
  }
  return error.status === 404;
}

export async function syncGoogleTasksForUser(
  options: SyncGoogleTasksOptions,
): Promise<SyncGoogleTasksResult> {
  const minIntervalSeconds =
    typeof options.minIntervalSeconds === "number"
      ? Math.max(0, Math.floor(options.minIntervalSeconds))
      : DEFAULT_MIN_SYNC_INTERVAL_SECONDS;

  try {
    const resolved = await resolveGoogleTaskListsForUser(options.uid, options.idToken);
    const link = resolved.link;
    if (!link.linked || !link.refreshToken.trim()) {
      return {
        kind: "skipped",
        reason: "not_linked",
        importedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        pushedCount: 0,
      };
    }
    if (!link.familyId) {
      return {
        kind: "skipped",
        reason: "family_not_found",
        importedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        pushedCount: 0,
      };
    }
    const selectedTaskLists = resolved.selectedTaskLists;
    if (selectedTaskLists.length === 0) {
      return {
        kind: "skipped",
        reason: "task_list_not_found",
        importedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        pushedCount: 0,
      };
    }

    const now = new Date().toISOString();
    const todayIsoDate = now.slice(0, 10);
    const lastSyncedMillis = toUnixMillis(link.lastSyncedAt);
    if (
      !options.force &&
      lastSyncedMillis > 0 &&
      Date.now() - lastSyncedMillis < minIntervalSeconds * 1000
    ) {
      return {
        kind: "skipped",
        reason: "min_interval",
        importedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        pushedCount: 0,
      };
    }

    const selectedTaskListIds = new Set(selectedTaskLists.map((entry) => entry.id));
    const remoteTaskGroups = await Promise.all(
      selectedTaskLists.map(async (taskList) => ({
        taskListId: taskList.id,
        tasks: await listGoogleTasks(link.accessToken, taskList.id),
      })),
    );
    const remoteTaskEntries = remoteTaskGroups.flatMap((group) =>
      group.tasks.map((task) => ({ taskListId: group.taskListId, task })),
    );
    const choreDocs = await listDocuments(`families/${link.familyId}/chores`, options.idToken, 1000);
    const allChores = choreDocs.map((doc) => parseLocalChore(doc));
    const localGoogleChores = allChores
      .filter((chore) => chore.source === GOOGLE_TASKS_CHORE_SOURCE)
      .filter((chore) => chore.googleTaskOwnerUid === options.uid)
      .filter((chore) => selectedTaskListIds.has(chore.googleTaskListId))
      .filter((chore) => Boolean(chore.googleTaskId));
    const localByTaskKey = new Map<string, LocalChore>();
    for (const chore of localGoogleChores) {
      const key = `${chore.googleTaskListId}:${chore.googleTaskId}`;
      const existing = localByTaskKey.get(key);
      if (!existing || localAuthorityMillis(chore) > localAuthorityMillis(existing)) {
        localByTaskKey.set(key, chore);
      }
    }
    const openChores = allChores
      .filter((chore) => !chore.deleted && chore.status === "Open")
      .sort(compareBySortOrderOrOldest);
    let nextSortOrder =
      openChores.reduce((maxValue, chore) => {
        if (typeof chore.sortOrder !== "number") {
          return maxValue;
        }
        return Math.max(maxValue, chore.sortOrder);
      }, -1) + 1;
    let activeChoresForOwner = allChores.filter(
      (chore) =>
        !chore.deleted &&
        chore.status !== "Deleted" &&
        chore.assigneeId === options.uid,
    ).length;
    const assigneeName = await resolveAssigneeName(
      link.familyId,
      options.uid,
      options.idToken,
      link.displayName || link.email,
    );

    let importedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let pushedCount = 0;
    const seenRemoteTaskKeys = new Set<string>();

    for (const remoteTaskEntry of remoteTaskEntries) {
      const remoteTask = remoteTaskEntry.task;
      const remoteTaskListId = remoteTaskEntry.taskListId;
      const remoteTaskKey = `${remoteTaskListId}:${remoteTask.id}`;
      seenRemoteTaskKeys.add(remoteTaskKey);
      const localChore = localByTaskKey.get(remoteTaskKey);
      const remoteUpdatedAt = remoteTask.updated || remoteTask.completed || now;
      const remoteUpdatedMillis = toUnixMillis(remoteUpdatedAt);

      if (!localChore) {
        if (remoteTask.deleted) {
          continue;
        }
        if (activeChoresForOwner >= MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
          continue;
        }
        const createdAt = remoteUpdatedAt;
        const dueDate = toIsoDateOrToday(googleDueToDueDate(remoteTask.due) || todayIsoDate);
        const status = remoteTask.status === "completed" ? "Submitted" : "Open";
        if (status === "Open" && isFutureDueDate(dueDate, todayIsoDate)) {
          continue;
        }
        const choreId = randomUUID();
        await createOrReplaceDocument(
          `families/${link.familyId}/chores/${choreId}`,
          {
            title: stringField(normalizeTitle(remoteTask.title)),
            status: stringField(status),
            assigneeId: stringField(options.uid),
            assigneeName: stringField(assigneeName),
            details: stringField(normalizeDetails(remoteTask.notes ?? "")),
            dueDate: stringField(dueDate),
            coinValue: integerField(DEFAULT_CHORE_COINS_FOR_IMPORTED_GOOGLE_TASKS),
            deleted: boolField(false),
            createdBy: stringField(options.uid),
            createdAt: timestampField(createdAt),
            updatedAt: timestampField(remoteUpdatedAt),
            sortOrder: integerField(nextSortOrder),
            source: stringField(GOOGLE_TASKS_CHORE_SOURCE),
            googleTaskId: stringField(remoteTask.id),
            googleTaskListId: stringField(remoteTaskListId),
            googleTaskOwnerUid: stringField(options.uid),
            ...(status === "Submitted"
              ? { submittedAt: timestampField(remoteTask.completed || remoteUpdatedAt) }
              : {}),
          },
          options.idToken,
        );
        await publishFamilyActivity({
          type: "chore_created",
          familyId: link.familyId,
          choreId,
          occurredAt: now,
        });
        nextSortOrder += 1;
        importedCount += 1;
        activeChoresForOwner += 1;
        continue;
      }

      const localUpdatedMillis = localAuthorityMillis(localChore);
      if (remoteUpdatedMillis > localUpdatedMillis + LOCAL_REMOTE_AUTHORITY_TOLERANCE_MILLIS) {
        if (remoteTask.deleted) {
          if (!localChore.deleted || localChore.status !== "Deleted") {
            await patchDocument(
              `families/${link.familyId}/chores/${localChore.id}`,
              {
                deleted: boolField(true),
                deletedAt: timestampField(remoteUpdatedAt),
                status: stringField("Deleted"),
                updatedAt: timestampField(remoteUpdatedAt),
              },
              options.idToken,
              ["deleted", "deletedAt", "status", "updatedAt"],
            );
            await publishFamilyActivity({
              type: "chore_deleted",
              familyId: link.familyId,
              choreId: localChore.id,
              occurredAt: now,
            });
            deletedCount += 1;
          }
          continue;
        }

        const nextStatus = remoteTask.status === "completed" ? "Submitted" : "Open";
        const nextTitle = normalizeTitle(remoteTask.title);
        const nextDetails = normalizeDetails(remoteTask.notes ?? "");
        const nextDueDate = googleDueToDueDate(remoteTask.due) || localChore.dueDate || now.slice(0, 10);
        const patchFields: Record<string, FirestoreValue> = {};
        const updateMask: string[] = [];
        if (localChore.title !== nextTitle) {
          patchFields.title = stringField(nextTitle);
          updateMask.push("title");
        }
        if (localChore.details !== nextDetails) {
          patchFields.details = stringField(nextDetails);
          updateMask.push("details");
        }
        if (localChore.dueDate !== nextDueDate) {
          patchFields.dueDate = stringField(nextDueDate);
          updateMask.push("dueDate");
        }
        if (localChore.status !== nextStatus) {
          patchFields.status = stringField(nextStatus);
          updateMask.push("status");
        }
        if (localChore.assigneeId !== options.uid) {
          patchFields.assigneeId = stringField(options.uid);
          updateMask.push("assigneeId");
        }
        if (localChore.assigneeName !== assigneeName) {
          patchFields.assigneeName = stringField(assigneeName);
          updateMask.push("assigneeName");
        }
        if (localChore.deleted) {
          patchFields.deleted = boolField(false);
          updateMask.push("deleted");
        }
        if (nextStatus === "Submitted") {
          const nextSubmittedAt = remoteTask.completed || remoteUpdatedAt;
          if (toUnixMillis(localChore.submittedAt) !== toUnixMillis(nextSubmittedAt)) {
            patchFields.submittedAt = timestampField(nextSubmittedAt);
            updateMask.push("submittedAt");
          }
        }
        if (updateMask.length > 0) {
          patchFields.updatedAt = timestampField(remoteUpdatedAt);
          updateMask.push("updatedAt");
          await patchDocument(
            `families/${link.familyId}/chores/${localChore.id}`,
            patchFields,
            options.idToken,
            updateMask,
          );
          await publishFamilyActivity({
            type: "chore_updated",
            familyId: link.familyId,
            choreId: localChore.id,
            occurredAt: now,
          });
          updatedCount += 1;
        }
        continue;
      }

      if (localUpdatedMillis > remoteUpdatedMillis + LOCAL_REMOTE_AUTHORITY_TOLERANCE_MILLIS) {
        if (localChore.deleted || localChore.status === "Deleted") {
          if (!remoteTask.deleted) {
            try {
              await deleteGoogleTask(link.accessToken, remoteTaskListId, remoteTask.id);
            } catch (error) {
              if (!isGoogleTaskNotFound(error)) {
                throw error;
              }
            }
            pushedCount += 1;
          }
          continue;
        }

        const status = isCompletedStatus(localChore.status) ? "completed" : "needsAction";
        const due = dueDateToGoogleDue(localChore.dueDate);
        const notes = normalizeDetails(localChore.details);
        try {
          await patchGoogleTask(link.accessToken, remoteTaskListId, remoteTask.id, {
            title: normalizeTitle(localChore.title),
            notes,
            due,
            status,
            ...(status === "completed"
              ? { completed: localChore.submittedAt || localChore.updatedAt || now }
              : {}),
          });
        } catch (error) {
          if (!isGoogleTaskNotFound(error)) {
            throw error;
          }
          const createdTask = await createGoogleTask(link.accessToken, remoteTaskListId, {
            title: normalizeTitle(localChore.title),
            notes,
            due,
            status,
          });
          await patchDocument(
            `families/${link.familyId}/chores/${localChore.id}`,
            {
              googleTaskId: stringField(createdTask.id),
            },
            options.idToken,
            ["googleTaskId"],
          );
        }
        pushedCount += 1;
      }
    }

    for (const localChore of localByTaskKey.values()) {
      const remoteTaskKey = `${localChore.googleTaskListId}:${localChore.googleTaskId}`;
      if (seenRemoteTaskKeys.has(remoteTaskKey)) {
        continue;
      }
      if (localChore.deleted || localChore.status === "Deleted") {
        continue;
      }
      const status = isCompletedStatus(localChore.status) ? "completed" : "needsAction";
      const due = dueDateToGoogleDue(localChore.dueDate);
      const notes = normalizeDetails(localChore.details);
      const targetTaskListId =
        localChore.googleTaskListId || selectedTaskLists[0]?.id || "";
      if (!targetTaskListId) {
        continue;
      }
      const createdTask = await createGoogleTask(link.accessToken, targetTaskListId, {
        title: normalizeTitle(localChore.title),
        notes,
        due,
        status,
      });
      await patchDocument(
        `families/${link.familyId}/chores/${localChore.id}`,
        {
          googleTaskId: stringField(createdTask.id),
        },
        options.idToken,
        ["googleTaskId"],
      );
      pushedCount += 1;
    }

    await updateGoogleTasksSyncMetadata({
      uid: options.uid,
      idToken: options.idToken,
      status: "ok",
      lastSyncedAt: now,
      error: "",
    });

    return {
      kind: "ok",
      importedCount,
      updatedCount,
      deletedCount,
      pushedCount,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "google_tasks_sync_failed";
    try {
      await updateGoogleTasksSyncMetadata({
        uid: options.uid,
        idToken: options.idToken,
        status: "error",
        lastSyncedAt: new Date().toISOString(),
        error: reason,
      });
    } catch {
      // Ignore secondary metadata write failures.
    }
    if (options.throwOnError) {
      throw error;
    }
    return {
      kind: "error",
      reason,
      importedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      pushedCount: 0,
    };
  }
}
