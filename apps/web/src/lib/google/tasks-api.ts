const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TASKS_API_BASE_URL = "https://tasks.googleapis.com/tasks/v1";
const ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS = 90;
const MAX_TASKS_PAGE_LOOPS = 50;

export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export class GoogleTasksHttpError extends Error {
  status: number;

  detail: string;

  constructor(status: number, detail: string) {
    super(`GOOGLE_TASKS_HTTP_${status}${detail ? `_${detail}` : ""}`);
    this.status = status;
    this.detail = detail;
  }
}

export type GoogleTasksTokenResult = {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  tokenType: string;
  expiresAt: string;
};

export type GoogleTaskList = {
  id: string;
  title: string;
  updated?: string;
  isDefault: boolean;
};

export type GoogleTaskItem = {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number | string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleTaskListsResponse = {
  items?: Array<{
    id?: string;
    title?: string;
    updated?: string;
  }>;
};

type GoogleTasksListResponse = {
  items?: Array<{
    id?: string;
    title?: string;
    notes?: string;
    status?: "needsAction" | "completed";
    due?: string;
    completed?: string;
    updated?: string;
    deleted?: boolean;
    hidden?: boolean;
  }>;
  nextPageToken?: string;
};

function getGoogleClientId() {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID_MISSING");
  }
  return clientId;
}

function getGoogleClientSecret() {
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientSecret) {
    throw new Error("GOOGLE_CLIENT_SECRET_MISSING");
  }
  return clientSecret;
}

function toIsoExpiry(expiresIn: number | string | undefined) {
  const expiresInSeconds = Number(expiresIn);
  const safeExpiresIn = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  return new Date(
    Date.now() + Math.max(0, safeExpiresIn - ACCESS_TOKEN_EXPIRY_BUFFER_SECONDS) * 1000,
  ).toISOString();
}

function parseGoogleTaskItem(
  value:
    | {
        id?: string;
        title?: string;
        notes?: string;
        status?: "needsAction" | "completed";
        due?: string;
        completed?: string;
        updated?: string;
        deleted?: boolean;
        hidden?: boolean;
      }
    | undefined,
): GoogleTaskItem | null {
  const id = value?.id?.trim() ?? "";
  if (!id) {
    return null;
  }
  return {
    id,
    title: value?.title?.trim() || "Untitled task",
    notes: value?.notes?.trim() || undefined,
    status: value?.status === "completed" ? "completed" : "needsAction",
    due: value?.due?.trim() || undefined,
    completed: value?.completed?.trim() || undefined,
    updated: value?.updated?.trim() || undefined,
    deleted: value?.deleted === true,
    hidden: value?.hidden === true,
  };
}

async function requestGoogleJson<T>(
  url: string,
  init: RequestInit & { accessToken?: string } = {},
) {
  const { accessToken, ...requestInit } = init;
  const headers = new Headers(requestInit.headers ?? {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (requestInit.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...requestInit,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as {
        error?: string | { message?: string; status?: string };
      };
      if (typeof payload.error === "string") {
        detail = payload.error;
      } else {
        detail = payload.error?.message ?? payload.error?.status ?? "";
      }
    } catch {
      detail = await response.text();
    }
    throw new GoogleTasksHttpError(response.status, detail.slice(0, 220));
  }

  if (response.status === 204) {
    return null as T;
  }
  return (await response.json()) as T;
}

export function buildGoogleTasksAuthUrl(input: {
  redirectUri: string;
  state: string;
  loginHint?: string;
}) {
  const params = new URLSearchParams();
  params.set("client_id", getGoogleClientId());
  params.set("redirect_uri", input.redirectUri);
  params.set("response_type", "code");
  params.set("scope", GOOGLE_TASKS_SCOPE);
  params.set("access_type", "offline");
  params.set("include_granted_scopes", "true");
  params.set("prompt", "consent");
  params.set("state", input.state);
  if (input.loginHint) {
    params.set("login_hint", input.loginHint);
  }
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGoogleTasksAuthCode(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTasksTokenResult> {
  const params = new URLSearchParams();
  params.set("code", input.code);
  params.set("client_id", getGoogleClientId());
  params.set("client_secret", getGoogleClientSecret());
  params.set("redirect_uri", input.redirectUri);
  params.set("grant_type", "authorization_code");

  const payload = await requestGoogleJson<GoogleTokenResponse>(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const accessToken = payload.access_token?.trim() ?? "";
  if (!accessToken) {
    throw new Error("GOOGLE_TASKS_ACCESS_TOKEN_MISSING");
  }

  return {
    accessToken,
    refreshToken: payload.refresh_token?.trim() || undefined,
    scope: payload.scope?.trim() || GOOGLE_TASKS_SCOPE,
    tokenType: payload.token_type?.trim() || "Bearer",
    expiresAt: toIsoExpiry(payload.expires_in),
  };
}

export async function refreshGoogleTasksAccessToken(input: {
  refreshToken: string;
}): Promise<GoogleTasksTokenResult> {
  const refreshToken = input.refreshToken.trim();
  if (!refreshToken) {
    throw new Error("GOOGLE_TASKS_REFRESH_TOKEN_MISSING");
  }

  const params = new URLSearchParams();
  params.set("client_id", getGoogleClientId());
  params.set("client_secret", getGoogleClientSecret());
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  const payload = await requestGoogleJson<GoogleTokenResponse>(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const accessToken = payload.access_token?.trim() ?? "";
  if (!accessToken) {
    throw new Error("GOOGLE_TASKS_ACCESS_TOKEN_MISSING");
  }

  return {
    accessToken,
    refreshToken: payload.refresh_token?.trim() || undefined,
    scope: payload.scope?.trim() || GOOGLE_TASKS_SCOPE,
    tokenType: payload.token_type?.trim() || "Bearer",
    expiresAt: toIsoExpiry(payload.expires_in),
  };
}

export async function listGoogleTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const payload = await requestGoogleJson<GoogleTaskListsResponse>(
    `${GOOGLE_TASKS_API_BASE_URL}/users/@me/lists?maxResults=100`,
    {
      method: "GET",
      accessToken,
    },
  );
  const taskLists: GoogleTaskList[] = [];
  for (const entry of payload.items ?? []) {
    const id = entry.id?.trim() ?? "";
    if (!id) {
      continue;
    }
    taskLists.push({
      id,
      title: entry.title?.trim() || "Untitled list",
      updated: entry.updated?.trim() || undefined,
      isDefault: id === "@default",
    });
  }
  return taskLists;
}

export async function listGoogleTasks(accessToken: string, taskListId: string): Promise<GoogleTaskItem[]> {
  const normalizedTaskListId = taskListId.trim();
  if (!normalizedTaskListId) {
    throw new Error("GOOGLE_TASK_LIST_ID_REQUIRED");
  }
  const items: GoogleTaskItem[] = [];
  let pageToken = "";
  let loopCount = 0;
  do {
    const params = new URLSearchParams();
    params.set("showCompleted", "true");
    params.set("showHidden", "true");
    params.set("showDeleted", "true");
    params.set("maxResults", "100");
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    const payload = await requestGoogleJson<GoogleTasksListResponse>(
      `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(normalizedTaskListId)}/tasks?${params.toString()}`,
      {
        method: "GET",
        accessToken,
      },
    );
    for (const item of payload.items ?? []) {
      const parsed = parseGoogleTaskItem(item);
      if (parsed) {
        items.push(parsed);
      }
    }
    pageToken = payload.nextPageToken?.trim() ?? "";
    loopCount += 1;
    if (loopCount > MAX_TASKS_PAGE_LOOPS) {
      throw new Error("GOOGLE_TASKS_PAGINATION_LIMIT_REACHED");
    }
  } while (pageToken);
  return items;
}

export async function createGoogleTask(
  accessToken: string,
  taskListId: string,
  body: {
    title: string;
    notes?: string;
    due?: string;
    status?: "needsAction" | "completed";
  },
) {
  const payload = await requestGoogleJson<{
    id?: string;
    title?: string;
    notes?: string;
    status?: "needsAction" | "completed";
    due?: string;
    completed?: string;
    updated?: string;
    deleted?: boolean;
    hidden?: boolean;
  }>(
    `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: "POST",
      accessToken,
      body: JSON.stringify(body),
    },
  );
  const parsed = parseGoogleTaskItem(payload);
  if (!parsed) {
    throw new Error("GOOGLE_TASKS_CREATE_RESPONSE_INVALID");
  }
  return parsed;
}

export async function patchGoogleTask(
  accessToken: string,
  taskListId: string,
  taskId: string,
  body: {
    title?: string;
    notes?: string;
    due?: string;
    status?: "needsAction" | "completed";
    completed?: string;
  },
) {
  const payload = await requestGoogleJson<{
    id?: string;
    title?: string;
    notes?: string;
    status?: "needsAction" | "completed";
    due?: string;
    completed?: string;
    updated?: string;
    deleted?: boolean;
    hidden?: boolean;
  }>(
    `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(
      taskId,
    )}`,
    {
      method: "PATCH",
      accessToken,
      body: JSON.stringify(body),
    },
  );
  const parsed = parseGoogleTaskItem(payload);
  if (!parsed) {
    throw new Error("GOOGLE_TASKS_PATCH_RESPONSE_INVALID");
  }
  return parsed;
}

export async function deleteGoogleTask(accessToken: string, taskListId: string, taskId: string) {
  await requestGoogleJson<null>(
    `${GOOGLE_TASKS_API_BASE_URL}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(
      taskId,
    )}`,
    {
      method: "DELETE",
      accessToken,
    },
  );
}
