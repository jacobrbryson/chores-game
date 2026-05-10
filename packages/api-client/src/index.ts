import {
  AchievementProgressSchema,
  ApiEnvelopeSchema,
  ChoreSchema,
  FamilyCurrentSchema,
  MeResponseSchema,
  NotificationSchema,
  PaginatedResponseSchema,
  QuestChoiceInputSchema,
  QuestSummarySchema,
  RedeemRewardInputSchema,
  RewardSchema,
  type ApiError,
} from "@packages/api-contracts";

type FetchLike = typeof fetch;

export type ApiClientConfig = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchImpl?: FetchLike;
};

class ApiClientError extends Error {
  status: number;
  details?: unknown;
  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = error.details;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function toQuery(params?: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    search.set(k, String(v));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

export function createApiClient(config: ApiClientConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  async function request<T>(path: string, init: RequestInit, dataSchema: any): Promise<T> {
    const token = await config.getAccessToken?.();
    const headers = new Headers(init.headers ?? {});
    headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);

    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    const json = await response.json().catch(() => ({}));
    const envelope = ApiEnvelopeSchema(dataSchema).safeParse(json);
    if (envelope.success) {
      if (!envelope.data.ok) {
        throw new ApiClientError(envelope.data.error, response.status);
      }
      return envelope.data.data;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return dataSchema.parse(json);
  }

  return {
    auth: {
      me: () => request("/me", { method: "GET" }, MeResponseSchema),
    },
    families: {
      getCurrent: () => request("/families/current", { method: "GET" }, FamilyCurrentSchema),
    },
    chores: {
      list: (query?: { page?: number; limit?: number }) =>
        request(`/chores${toQuery(query)}`, { method: "GET" }, PaginatedResponseSchema(ChoreSchema)),
      create: (input: Record<string, unknown>) => request("/chores", { method: "POST", body: JSON.stringify(input) }, ChoreSchema),
      complete: (id: string) => request(`/chores/${id}/complete`, { method: "POST" }, ChoreSchema),
      approve: (id: string) => request(`/chores/${id}/approve`, { method: "POST" }, ChoreSchema),
    },
    rewards: {
      list: () => request("/rewards", { method: "GET" }, PaginatedResponseSchema(RewardSchema)),
      redeem: (id: string) => {
        RedeemRewardInputSchema.parse({ rewardId: id });
        return request(`/rewards/${id}/redeem`, { method: "POST" }, RewardSchema);
      },
    },
    quests: {
      list: () => request("/quests", { method: "GET" }, PaginatedResponseSchema(QuestSummarySchema)),
      getById: (id: string) => request(`/quests/${id}`, { method: "GET" }, QuestSummarySchema),
      start: (id: string) => request(`/quests/${id}/start`, { method: "POST" }, QuestSummarySchema),
      submitChoice: (id: string, input: { choiceId: string; purchaseIfMissing?: boolean }) => {
        QuestChoiceInputSchema.parse(input);
        return request(`/quests/${id}/choice`, { method: "POST", body: JSON.stringify(input) }, QuestSummarySchema);
      },
    },
    achievements: {
      list: () => request("/achievements", { method: "GET" }, PaginatedResponseSchema(AchievementProgressSchema)),
    },
    notifications: {
      list: () => request("/notifications", { method: "GET" }, PaginatedResponseSchema(NotificationSchema)),
    },
  };
}

export { ApiClientError };
