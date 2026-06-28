import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listAllDocuments,
  listDocuments,
  patchDocument,
  readBoolean,
  readInteger,
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
import { collapseRoutineChores } from "@/lib/responsibility/routine-chores";
import {
  acquireGoogleTasksSyncLease,
  releaseGoogleTasksSyncLease,
} from "@/lib/google/tasks-sync-lease";
import { applyWalletDelta } from "@/lib/economy/wallet";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";

export const GOOGLE_TASKS_CHORE_SOURCE = "google_tasks";

const DEFAULT_CHORE_COINS_FOR_IMPORTED_GOOGLE_TASKS = 10;
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
  coinValue: number;
  sortOrder?: number;
  source: string;
  googleTaskId: string;
  googleTaskListId: string;
  googleTaskOwnerUid: string;
  routineAssignmentId?: string;
  routineStepOrder?: number;
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

function isDueAndCompletedBeforeSyncDate(
  task: { status: string; due?: string; completed?: string },
  syncIsoDate: string,
) {
  if (task.status !== "completed") {
    return false;
  }
  const dueDate = googleDueToDueDate(task.due);
  if (!dueDate || dueDate >= syncIsoDate) {
    return false;
  }
  const completedAtMillis = toUnixMillis(task.completed ?? "");
  if (!completedAtMillis) {
    return false;
  }
  const completedIsoDate = new Date(completedAtMillis).toISOString().slice(0, 10);
  return completedIsoDate < syncIsoDate;
}

function isCompletedStatus(value: string) {
  return value === "Submitted" || value === "Approved";
}

function localAuthorityMillis(chore: LocalChore) {
  return toUnixMillis(chore.updatedAt) || toUnixMillis(chore.submittedAt) || toUnixMillis(chore.createdAt);
}

function isGoogleMappedChoreForOwner(chore: LocalChore, ownerUid: string) {
  if (!chore.googleTaskId || !chore.googleTaskListId) {
    return false;
  }
  if (chore.googleTaskOwnerUid && chore.googleTaskOwnerUid !== ownerUid) {
    return false;
  }
  if (!chore.googleTaskOwnerUid && chore.assigneeId !== ownerUid) {
    return false;
  }
  return true;
}


function isUnmappedLocalChoreForOwner(
  chore: LocalChore,
  ownerUid: string,
  mappedChoreIds: Set<string>,
) {
  if (mappedChoreIds.has(chore.id)) {
    return false;
  }
  if (chore.deleted || chore.status === "Deleted") {
    return false;
  }
  if (chore.assigneeId !== ownerUid) {
    return false;
  }
  if (chore.googleTaskOwnerUid && chore.googleTaskOwnerUid !== ownerUid) {
    return false;
  }
  return true;
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
    coinValue: Math.max(0, readInteger(doc.fields, "coinValue") || 0),
    sortOrder: readOptionalSortOrder(doc.fields),
    source: readString(doc.fields, "source"),
    googleTaskId: readString(doc.fields, "googleTaskId"),
    googleTaskListId: readString(doc.fields, "googleTaskListId"),
    googleTaskOwnerUid: readString(doc.fields, "googleTaskOwnerUid"),
    routineAssignmentId: readString(doc.fields, "routineAssignmentId") || undefined,
    routineStepOrder: readInteger(doc.fields, "routineStepOrder") || undefined,
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

async function resolveAssigneeUid(familyId: string, assigneeId: string, idToken: string) {
  if (!assigneeId) {
    return "";
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    const memberUid = readString(memberDoc.fields, "uid");
    return memberUid || assigneeId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return assigneeId;
    }
    throw error;
  }
}

async function unlinkGoogleTaskMapping(
  familyId: string,
  choreId: string,
  idToken: string,
  updatedAtIso: string,
) {
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      source: stringField("manual"),
      googleTaskOwnerUid: stringField(""),
      googleTaskListId: stringField(""),
      googleTaskId: stringField(""),
      updatedAt: timestampField(updatedAtIso),
    },
    idToken,
    ["source", "googleTaskOwnerUid", "googleTaskListId", "googleTaskId", "updatedAt"],
  );
}

function isGoogleTaskNotFound(error: unknown) {
  if (!(error instanceof GoogleTasksHttpError)) {
    return false;
  }
  return error.status === 404;
}

function isGoogleTaskForbidden(error: unknown) {
  if (!(error instanceof GoogleTasksHttpError)) {
    return false;
  }
  return error.status === 403;
}

export async function syncGoogleTasksForUser(
  options: SyncGoogleTasksOptions,
): Promise<SyncGoogleTasksResult> {
  let syncLeaseId = "";
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

    const acquiredLeaseId = await acquireGoogleTasksSyncLease({
      uid: options.uid,
      idToken: options.idToken,
    });
    if (!acquiredLeaseId) {
      return {
        kind: "skipped",
        reason: "sync_in_progress",
        importedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        pushedCount: 0,
      };
    }
    syncLeaseId = acquiredLeaseId;

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
    const choreDocs = await listAllDocuments(`families/${link.familyId}/chores`, options.idToken, {
      cap: 5000,
    });
    const allChores = choreDocs.map((doc) => parseLocalChore(doc));
    // A routine assignment materializes one chore per step, but only the next
    // open step should ever reach Google Tasks — otherwise every step is pushed
    // at once. collapseRoutineChores retains all non-routine and already
    // completed chores and, per assignment, only the lowest-order open step.
    // Anything routine-linked that survives is "active"; anything else is a
    // later step we must suppress from every push path below.
    const ownerActiveChoreIds = new Set(
      collapseRoutineChores(
        allChores.filter((chore) => !chore.deleted && chore.assigneeId === options.uid),
      ).map((chore) => chore.id),
    );
    const isSuppressedRoutineStep = (chore: LocalChore) =>
      Boolean(chore.routineAssignmentId) && !ownerActiveChoreIds.has(chore.id);
    const localGoogleChores = allChores
      .filter((chore) => isGoogleMappedChoreForOwner(chore, options.uid))
      .filter((chore) => selectedTaskListIds.has(chore.googleTaskListId));
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
      let localChore = localByTaskKey.get(remoteTaskKey);

      // Only skip older completed tasks when they would be a brand-new import.
      // Existing mapped chores must still reconcile to remote completion state.
      if (!localChore && isDueAndCompletedBeforeSyncDate(remoteTask, todayIsoDate)) {
        continue;
      }
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

      const metadataPatchFields: Record<string, FirestoreValue> = {};
      const metadataUpdateMask: string[] = [];
      if (localChore.source !== GOOGLE_TASKS_CHORE_SOURCE) {
        metadataPatchFields.source = stringField(GOOGLE_TASKS_CHORE_SOURCE);
        metadataUpdateMask.push("source");
      }
      if (localChore.googleTaskOwnerUid !== options.uid) {
        metadataPatchFields.googleTaskOwnerUid = stringField(options.uid);
        metadataUpdateMask.push("googleTaskOwnerUid");
      }
      if (localChore.googleTaskListId !== remoteTaskListId) {
        metadataPatchFields.googleTaskListId = stringField(remoteTaskListId);
        metadataUpdateMask.push("googleTaskListId");
      }
      if (localChore.googleTaskId !== remoteTask.id) {
        metadataPatchFields.googleTaskId = stringField(remoteTask.id);
        metadataUpdateMask.push("googleTaskId");
      }
      if (metadataUpdateMask.length > 0) {
        await patchDocument(
          `families/${link.familyId}/chores/${localChore.id}`,
          metadataPatchFields,
          options.idToken,
          metadataUpdateMask,
        );
      }

      if (localChore.assigneeId !== options.uid) {
        let canUnlink = remoteTask.deleted;
        if (!remoteTask.deleted) {
          try {
            await deleteGoogleTask(link.accessToken, remoteTaskListId, remoteTask.id);
            canUnlink = true;
            pushedCount += 1;
          } catch (error) {
            if (isGoogleTaskNotFound(error)) {
              canUnlink = true;
            } else if (isGoogleTaskForbidden(error)) {
              continue;
            } else {
              throw error;
            }
          }
        }
        if (canUnlink) {
          await unlinkGoogleTaskMapping(link.familyId, localChore.id, options.idToken, now);
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

        const nextStatus =
          remoteTask.status === "completed"
            ? localChore.status === "Approved"
              ? "Approved"
              : "Submitted"
            : "Open";
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
        const statusChanged = localChore.status !== nextStatus;
        if (statusChanged) {
          patchFields.status = stringField(nextStatus);
          updateMask.push("status");
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
          if (statusChanged) {
            await writeAuditLogBestEffort({
              familyId: link.familyId,
              idToken: options.idToken,
              eventType: "chore_status_changed",
              actor: { uid: options.uid, role: "system", name: "Google Tasks sync" },
              userId: localChore.assigneeId,
              choreId: localChore.id,
              choreTitle: localChore.title,
              source: GOOGLE_TASKS_CHORE_SOURCE,
              previous: { status: localChore.status },
              next: { status: nextStatus },
              reason: "google_tasks_remote_reconcile",
            });
          }
          if (statusChanged && localChore.coinValue > 0) {
            const assigneeUid = await resolveAssigneeUid(link.familyId, localChore.assigneeId, options.idToken);
            if (assigneeUid) {
              const walletDelta = nextStatus === "Submitted" ? localChore.coinValue : -localChore.coinValue;
              const walletReason = nextStatus === "Submitted" ? "chore_complete" : "chore_undo_complete";
              try {
                await applyWalletDelta({
                  uid: assigneeUid,
                  idToken: options.idToken,
                  delta: walletDelta,
                  reason: walletReason,
                  choreId: localChore.id,
                });
              } catch (error) {
                const reason = error instanceof Error ? error.message : "";
                if (!reason.includes("FIRESTORE_HTTP_404")) {
                  throw error;
                }
              }
            }
          }
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
            let pushedRemoteDelete = false;
            try {
              await deleteGoogleTask(link.accessToken, remoteTaskListId, remoteTask.id);
              pushedRemoteDelete = true;
            } catch (error) {
              if (isGoogleTaskNotFound(error)) {
                pushedRemoteDelete = true;
              } else if (!isGoogleTaskForbidden(error)) {
                throw error;
              }
            }
            if (pushedRemoteDelete) {
              pushedCount += 1;
            }
          }
          continue;
        }

        const status = isCompletedStatus(localChore.status) ? "completed" : "needsAction";
        const due = dueDateToGoogleDue(localChore.dueDate);
        const notes = normalizeDetails(localChore.details);
        let pushedRemoteTask = false;
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
          pushedRemoteTask = true;
        } catch (error) {
          if (isGoogleTaskForbidden(error)) {
            continue;
          }
          if (!isGoogleTaskNotFound(error)) {
            throw error;
          }
          try {
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
            pushedRemoteTask = true;
          } catch (createError) {
            if (isGoogleTaskForbidden(createError)) {
              continue;
            }
            throw createError;
          }
        }
        if (pushedRemoteTask) {
          pushedCount += 1;
        }
      }
    }

    for (const localChore of localByTaskKey.values()) {
      const remoteTaskKey = `${localChore.googleTaskListId}:${localChore.googleTaskId}`;
      if (seenRemoteTaskKeys.has(remoteTaskKey)) {
        continue;
      }
      if (localChore.assigneeId !== options.uid) {
        await unlinkGoogleTaskMapping(link.familyId, localChore.id, options.idToken, now);
        await publishFamilyActivity({
          type: "chore_updated",
          familyId: link.familyId,
          choreId: localChore.id,
          occurredAt: now,
        });
        updatedCount += 1;
        continue;
      }
      if (localChore.deleted || localChore.status === "Deleted") {
        continue;
      }
      // Don't recreate a later routine step that shouldn't exist in Google yet.
      if (isSuppressedRoutineStep(localChore)) {
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
      try {
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
      } catch (error) {
        if (!isGoogleTaskForbidden(error)) {
          throw error;
        }
      }
    }

    const mappedChoreIds = new Set(Array.from(localByTaskKey.values()).map((chore) => chore.id));
    const localUnmappedOwnerChores = allChores
      .filter((chore) => isUnmappedLocalChoreForOwner(chore, options.uid, mappedChoreIds))
      .sort(compareBySortOrderOrOldest);

    for (const localChore of localUnmappedOwnerChores) {
      // Push routine steps one at a time: skip every step except the next open
      // one so a multi-step routine doesn't create all its tasks at once.
      if (isSuppressedRoutineStep(localChore)) {
        continue;
      }
      const status = isCompletedStatus(localChore.status) ? "completed" : "needsAction";
      const due = dueDateToGoogleDue(localChore.dueDate);
      const notes = normalizeDetails(localChore.details);
      const targetTaskListId =
        localChore.googleTaskListId && selectedTaskListIds.has(localChore.googleTaskListId)
          ? localChore.googleTaskListId
          : selectedTaskLists[0]?.id || "";
      if (!targetTaskListId) {
        continue;
      }
      try {
        const createdTask = await createGoogleTask(link.accessToken, targetTaskListId, {
          title: normalizeTitle(localChore.title),
          notes,
          due,
          status,
        });
        await patchDocument(
          `families/${link.familyId}/chores/${localChore.id}`,
          {
            source: stringField(GOOGLE_TASKS_CHORE_SOURCE),
            googleTaskOwnerUid: stringField(options.uid),
            googleTaskListId: stringField(targetTaskListId),
            googleTaskId: stringField(createdTask.id),
          },
          options.idToken,
          ["source", "googleTaskOwnerUid", "googleTaskListId", "googleTaskId"],
        );
        pushedCount += 1;
      } catch (error) {
        if (!isGoogleTaskForbidden(error)) {
          throw error;
        }
      }
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
  } finally {
    if (syncLeaseId) {
      await releaseGoogleTasksSyncLease({
        uid: options.uid,
        idToken: options.idToken,
        leaseId: syncLeaseId,
      });
    }
  }
}
