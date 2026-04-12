import {
  boolField,
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  GoogleTasksHttpError,
  type GoogleTaskList,
  type GoogleTasksTokenResult,
  listGoogleTaskLists,
  refreshGoogleTasksAccessToken,
} from "@/lib/google/tasks-api";

const GOOGLE_TOKEN_REFRESH_BUFFER_MILLIS = 60 * 1000;

export type GoogleTasksSyncStatus = "idle" | "ok" | "error";

export type GoogleTasksUserLink = {
  uid: string;
  familyId: string;
  email: string;
  displayName: string;
  accountLinked: boolean;
  linked: boolean;
  linkedAt: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  scope: string;
  selectedTaskListIds: string[];
  selectedTaskListTitles: string[];
  selectedTaskListId: string;
  selectedTaskListTitle: string;
  lastSyncedAt: string;
  lastSyncStatus: GoogleTasksSyncStatus;
  lastSyncError: string;
};

export type GoogleTasksProfileState = {
  accountLinked: boolean;
  linked: boolean;
  linkedAt?: string;
  lastSyncedAt?: string;
  lastSyncStatus: GoogleTasksSyncStatus;
  lastSyncError?: string;
  selectedTaskListIds?: string[];
  selectedTaskListTitles?: string[];
  selectedTaskListId?: string;
  selectedTaskListTitle?: string;
  taskLists: GoogleTaskList[];
};

function toUnixMillis(value: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function asSyncStatus(value: string): GoogleTasksSyncStatus {
  if (value === "ok" || value === "error" || value === "idle") {
    return value;
  }
  return "idle";
}

function normalizeUniqueIds(ids: string[]) {
  const normalized = ids
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

function hasSameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function chooseTaskLists(taskLists: GoogleTaskList[], preferredTaskListIds: string[]) {
  if (taskLists.length === 0) {
    return [] as GoogleTaskList[];
  }
  const selected: GoogleTaskList[] = [];
  const seen = new Set<string>();
  for (const taskListId of preferredTaskListIds) {
    const found = taskLists.find((entry) => entry.id === taskListId);
    if (!found || seen.has(found.id)) {
      continue;
    }
    selected.push(found);
    seen.add(found.id);
  }
  if (selected.length > 0) {
    return selected;
  }
  const fallback = taskLists.find((entry) => entry.isDefault) ?? taskLists[0];
  return fallback ? [fallback] : [];
}

async function clearLinkForInvalidGrant(uid: string, idToken: string) {
  const now = new Date().toISOString();
  await patchDocument(
    `users/${uid}`,
    {
      googleTasksLinked: boolField(false),
      googleTasksRefreshToken: stringField(""),
      googleTasksAccessToken: stringField(""),
      googleTasksAccessTokenExpiresAt: stringField(""),
      googleTasksScope: stringField(""),
      googleTasksSelectedTaskListIds: stringArrayField([]),
      googleTasksSelectedTaskListTitles: stringArrayField([]),
      googleTasksSelectedTaskListId: stringField(""),
      googleTasksSelectedTaskListTitle: stringField(""),
      googleTasksLastSyncStatus: stringField("error"),
      googleTasksLastSyncError: stringField("google_tasks_access_revoked"),
      googleTasksUpdatedAt: timestampField(now),
    },
    idToken,
    [
      "googleTasksLinked",
      "googleTasksRefreshToken",
      "googleTasksAccessToken",
      "googleTasksAccessTokenExpiresAt",
      "googleTasksScope",
      "googleTasksSelectedTaskListIds",
      "googleTasksSelectedTaskListTitles",
      "googleTasksSelectedTaskListId",
      "googleTasksSelectedTaskListTitle",
      "googleTasksLastSyncStatus",
      "googleTasksLastSyncError",
      "googleTasksUpdatedAt",
    ],
  );
}

export async function getGoogleTasksUserLink(uid: string, idToken: string): Promise<GoogleTasksUserLink> {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const selectedTaskListIds = normalizeUniqueIds(readStringArray(userDoc.fields, "googleTasksSelectedTaskListIds"));
  const selectedTaskListTitles = readStringArray(userDoc.fields, "googleTasksSelectedTaskListTitles");
  const legacySelectedTaskListId = readString(userDoc.fields, "googleTasksSelectedTaskListId");
  const legacySelectedTaskListTitle = readString(userDoc.fields, "googleTasksSelectedTaskListTitle");
  const resolvedSelectedTaskListIds =
    selectedTaskListIds.length > 0
      ? selectedTaskListIds
      : legacySelectedTaskListId
        ? [legacySelectedTaskListId]
        : [];
  const resolvedSelectedTaskListTitles =
    selectedTaskListTitles.length > 0
      ? selectedTaskListTitles
      : legacySelectedTaskListTitle
        ? [legacySelectedTaskListTitle]
        : [];
  return {
    uid,
    familyId: readStringArray(userDoc.fields, "familyIds")[0] ?? "",
    email: readString(userDoc.fields, "email"),
    displayName: readString(userDoc.fields, "displayName") || readString(userDoc.fields, "name"),
    accountLinked: readString(userDoc.fields, "provider") === "google",
    linked: readBoolean(userDoc.fields, "googleTasksLinked"),
    linkedAt: readTimestamp(userDoc.fields, "googleTasksLinkedAt") || "",
    refreshToken: readString(userDoc.fields, "googleTasksRefreshToken"),
    accessToken: readString(userDoc.fields, "googleTasksAccessToken"),
    accessTokenExpiresAt:
      readTimestamp(userDoc.fields, "googleTasksAccessTokenExpiresAt") ||
      readString(userDoc.fields, "googleTasksAccessTokenExpiresAt"),
    scope: readString(userDoc.fields, "googleTasksScope"),
    selectedTaskListIds: resolvedSelectedTaskListIds,
    selectedTaskListTitles: resolvedSelectedTaskListTitles,
    selectedTaskListId: resolvedSelectedTaskListIds[0] ?? "",
    selectedTaskListTitle: resolvedSelectedTaskListTitles[0] ?? "",
    lastSyncedAt: readTimestamp(userDoc.fields, "googleTasksLastSyncedAt") || "",
    lastSyncStatus: asSyncStatus(readString(userDoc.fields, "googleTasksLastSyncStatus")),
    lastSyncError: readString(userDoc.fields, "googleTasksLastSyncError"),
  };
}

export async function ensureGoogleTasksAccessToken(
  link: GoogleTasksUserLink,
  idToken: string,
): Promise<GoogleTasksUserLink> {
  if (!link.linked || !link.refreshToken.trim()) {
    return link;
  }
  const nowMillis = Date.now();
  const expiresAtMillis = toUnixMillis(link.accessTokenExpiresAt);
  if (link.accessToken.trim() && expiresAtMillis > nowMillis + GOOGLE_TOKEN_REFRESH_BUFFER_MILLIS) {
    return link;
  }

  try {
    const refreshed = await refreshGoogleTasksAccessToken({
      refreshToken: link.refreshToken,
    });
    const now = new Date().toISOString();
    const nextRefreshToken = refreshed.refreshToken?.trim() || link.refreshToken;
    await patchDocument(
      `users/${link.uid}`,
      {
        googleTasksAccessToken: stringField(refreshed.accessToken),
        googleTasksAccessTokenExpiresAt: timestampField(refreshed.expiresAt),
        googleTasksRefreshToken: stringField(nextRefreshToken),
        googleTasksScope: stringField(refreshed.scope),
        googleTasksUpdatedAt: timestampField(now),
      },
      idToken,
      [
        "googleTasksAccessToken",
        "googleTasksAccessTokenExpiresAt",
        "googleTasksRefreshToken",
        "googleTasksScope",
        "googleTasksUpdatedAt",
      ],
    );

    return {
      ...link,
      refreshToken: nextRefreshToken,
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const isInvalidGrant =
      (error instanceof GoogleTasksHttpError && error.status === 400 && error.detail.includes("invalid_grant")) ||
      reason.includes("invalid_grant");
    if (isInvalidGrant) {
      await clearLinkForInvalidGrant(link.uid, idToken);
      return {
        ...link,
        linked: false,
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: "",
      };
    }
    throw error;
  }
}

export async function resolveGoogleTaskListsForUser(
  uid: string,
  idToken: string,
): Promise<{ link: GoogleTasksUserLink; taskLists: GoogleTaskList[]; selectedTaskLists: GoogleTaskList[] }> {
  let link = await getGoogleTasksUserLink(uid, idToken);
  if (!link.linked || !link.refreshToken.trim()) {
    return { link, taskLists: [], selectedTaskLists: [] };
  }
  link = await ensureGoogleTasksAccessToken(link, idToken);
  if (!link.linked || !link.accessToken.trim()) {
    return { link, taskLists: [], selectedTaskLists: [] };
  }

  const taskLists = await listGoogleTaskLists(link.accessToken);
  const selectedTaskLists = chooseTaskLists(
    taskLists,
    link.selectedTaskListIds.length > 0 ? link.selectedTaskListIds : [link.selectedTaskListId],
  );
  if (selectedTaskLists.length === 0) {
    return { link, taskLists, selectedTaskLists: [] };
  }
  const selectedTaskListIds = selectedTaskLists.map((entry) => entry.id);
  const selectedTaskListTitles = selectedTaskLists.map((entry) => entry.title);
  const selectedTaskListId = selectedTaskListIds[0] ?? "";
  const selectedTaskListTitle = selectedTaskListTitles[0] ?? "";

  if (
    !hasSameStringArray(link.selectedTaskListIds, selectedTaskListIds) ||
    !hasSameStringArray(link.selectedTaskListTitles, selectedTaskListTitles) ||
    link.selectedTaskListId !== selectedTaskListId ||
    link.selectedTaskListTitle !== selectedTaskListTitle
  ) {
    const now = new Date().toISOString();
    await patchDocument(
      `users/${uid}`,
      {
        googleTasksSelectedTaskListIds: stringArrayField(selectedTaskListIds),
        googleTasksSelectedTaskListTitles: stringArrayField(selectedTaskListTitles),
        googleTasksSelectedTaskListId: stringField(selectedTaskListId),
        googleTasksSelectedTaskListTitle: stringField(selectedTaskListTitle),
        googleTasksUpdatedAt: timestampField(now),
      },
      idToken,
      [
        "googleTasksSelectedTaskListIds",
        "googleTasksSelectedTaskListTitles",
        "googleTasksSelectedTaskListId",
        "googleTasksSelectedTaskListTitle",
        "googleTasksUpdatedAt",
      ],
    );
    link = {
      ...link,
      selectedTaskListIds,
      selectedTaskListTitles,
      selectedTaskListId,
      selectedTaskListTitle,
    };
  }

  return { link, taskLists, selectedTaskLists };
}

export async function persistGoogleTasksOAuthLink(input: {
  uid: string;
  idToken: string;
  token: GoogleTasksTokenResult;
  selectedTaskLists: GoogleTaskList[];
}) {
  const existing = await getGoogleTasksUserLink(input.uid, input.idToken);
  const now = new Date().toISOString();
  const refreshToken = input.token.refreshToken?.trim() || existing.refreshToken.trim();
  if (!refreshToken) {
    throw new Error("GOOGLE_TASKS_REFRESH_TOKEN_MISSING");
  }

  const selectedTaskListIds = input.selectedTaskLists.map((entry) => entry.id);
  const selectedTaskListTitles = input.selectedTaskLists.map((entry) => entry.title);
  const selectedTaskListId = selectedTaskListIds[0] ?? "";
  const selectedTaskListTitle = selectedTaskListTitles[0] ?? "";

  await patchDocument(
    `users/${input.uid}`,
    {
      googleTasksLinked: boolField(true),
      googleTasksRefreshToken: stringField(refreshToken),
      googleTasksAccessToken: stringField(input.token.accessToken),
      googleTasksAccessTokenExpiresAt: timestampField(input.token.expiresAt),
      googleTasksScope: stringField(input.token.scope),
      googleTasksLinkedAt: timestampField(existing.linkedAt || now),
      googleTasksSelectedTaskListIds: stringArrayField(selectedTaskListIds),
      googleTasksSelectedTaskListTitles: stringArrayField(selectedTaskListTitles),
      googleTasksSelectedTaskListId: stringField(selectedTaskListId),
      googleTasksSelectedTaskListTitle: stringField(selectedTaskListTitle),
      googleTasksLastSyncStatus: stringField("idle"),
      googleTasksLastSyncError: stringField(""),
      googleTasksUpdatedAt: timestampField(now),
    },
    input.idToken,
    [
      "googleTasksLinked",
      "googleTasksRefreshToken",
      "googleTasksAccessToken",
      "googleTasksAccessTokenExpiresAt",
      "googleTasksScope",
      "googleTasksLinkedAt",
      "googleTasksSelectedTaskListIds",
      "googleTasksSelectedTaskListTitles",
      "googleTasksSelectedTaskListId",
      "googleTasksSelectedTaskListTitle",
      "googleTasksLastSyncStatus",
      "googleTasksLastSyncError",
      "googleTasksUpdatedAt",
    ],
  );
}

export async function updateGoogleTasksSyncMetadata(input: {
  uid: string;
  idToken: string;
  status: GoogleTasksSyncStatus;
  lastSyncedAt?: string;
  error?: string;
}) {
  const now = new Date().toISOString();
  const syncedAt = input.lastSyncedAt || now;
  await patchDocument(
    `users/${input.uid}`,
    {
      googleTasksLastSyncStatus: stringField(input.status),
      googleTasksLastSyncError: stringField(input.error ?? ""),
      googleTasksLastSyncedAt: timestampField(syncedAt),
      googleTasksUpdatedAt: timestampField(now),
    },
    input.idToken,
    [
      "googleTasksLastSyncStatus",
      "googleTasksLastSyncError",
      "googleTasksLastSyncedAt",
      "googleTasksUpdatedAt",
    ],
  );
}

export async function setGoogleTasksSelectedTaskLists(input: {
  uid: string;
  idToken: string;
  taskListIds: string[];
}) {
  const taskListIds = normalizeUniqueIds(input.taskListIds);
  if (taskListIds.length === 0) {
    throw new Error("GOOGLE_TASK_LIST_ID_REQUIRED");
  }
  const resolved = await resolveGoogleTaskListsForUser(input.uid, input.idToken);
  if (!resolved.link.linked) {
    throw new Error("GOOGLE_TASKS_NOT_LINKED");
  }
  const selectedTaskLists: GoogleTaskList[] = [];
  for (const taskListId of taskListIds) {
    const matched = resolved.taskLists.find((entry) => entry.id === taskListId);
    if (!matched) {
      throw new Error("GOOGLE_TASK_LIST_NOT_FOUND");
    }
    selectedTaskLists.push(matched);
  }
  const selectedTaskListTitles = selectedTaskLists.map((entry) => entry.title);
  const selectedTaskListId = selectedTaskLists[0]?.id ?? "";
  const selectedTaskListTitle = selectedTaskLists[0]?.title ?? "";
  const now = new Date().toISOString();
  await patchDocument(
    `users/${input.uid}`,
    {
      googleTasksSelectedTaskListIds: stringArrayField(taskListIds),
      googleTasksSelectedTaskListTitles: stringArrayField(selectedTaskListTitles),
      googleTasksSelectedTaskListId: stringField(selectedTaskListId),
      googleTasksSelectedTaskListTitle: stringField(selectedTaskListTitle),
      googleTasksUpdatedAt: timestampField(now),
    },
    input.idToken,
    [
      "googleTasksSelectedTaskListIds",
      "googleTasksSelectedTaskListTitles",
      "googleTasksSelectedTaskListId",
      "googleTasksSelectedTaskListTitle",
      "googleTasksUpdatedAt",
    ],
  );
}

export async function unlinkGoogleTasks(uid: string, idToken: string) {
  const now = new Date().toISOString();
  await patchDocument(`users/${uid}`,
    {
      googleTasksLinked: boolField(false),
      googleTasksRefreshToken: stringField(""),
      googleTasksAccessToken: stringField(""),
      googleTasksAccessTokenExpiresAt: stringField(""),
      googleTasksScope: stringField(""),
      googleTasksSelectedTaskListIds: stringArrayField([]),
      googleTasksSelectedTaskListTitles: stringArrayField([]),
      googleTasksSelectedTaskListId: stringField(""),
      googleTasksSelectedTaskListTitle: stringField(""),
      googleTasksLastSyncStatus: stringField("idle"),
      googleTasksLastSyncError: stringField(""),
      googleTasksUpdatedAt: timestampField(now),
    },
    idToken,
    [
      "googleTasksLinked",
      "googleTasksRefreshToken",
      "googleTasksAccessToken",
      "googleTasksAccessTokenExpiresAt",
      "googleTasksScope",
      "googleTasksSelectedTaskListIds",
      "googleTasksSelectedTaskListTitles",
      "googleTasksSelectedTaskListId",
      "googleTasksSelectedTaskListTitle",
      "googleTasksLastSyncStatus",
      "googleTasksLastSyncError",
      "googleTasksUpdatedAt",
    ],
  );

}

export async function getGoogleTasksProfileState(uid: string, idToken: string): Promise<GoogleTasksProfileState> {
  const resolved = await resolveGoogleTaskListsForUser(uid, idToken);
  if (!resolved.link.linked) {
    return {
      accountLinked: resolved.link.accountLinked,
      linked: false,
      lastSyncStatus: resolved.link.lastSyncStatus,
      lastSyncError: resolved.link.lastSyncError || undefined,
      selectedTaskListIds: [],
      selectedTaskListTitles: [],
      taskLists: [],
    };
  }
  const selectedTaskListIds = resolved.selectedTaskLists.map((entry) => entry.id);
  const selectedTaskListTitles = resolved.selectedTaskLists.map((entry) => entry.title);
  return {
    accountLinked: resolved.link.accountLinked,
    linked: true,
    linkedAt: resolved.link.linkedAt || undefined,
    lastSyncedAt: resolved.link.lastSyncedAt || undefined,
    lastSyncStatus: resolved.link.lastSyncStatus,
    lastSyncError: resolved.link.lastSyncError || undefined,
    selectedTaskListIds,
    selectedTaskListTitles,
    selectedTaskListId: selectedTaskListIds[0] || undefined,
    selectedTaskListTitle: selectedTaskListTitles[0] || undefined,
    taskLists: resolved.taskLists,
  };
}


