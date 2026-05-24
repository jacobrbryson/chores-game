export const PUBLIC_API_SCOPES = [
  "read:profile",
  "read:players",
  "read:coins",
  "read:chores",
  "read:achievements",
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export type ApiTokenStatus = "active" | "disabled" | "deleted";

export const PUBLIC_API_DAILY_LIMIT = 1000;

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit_exceeded"
  | "internal_error";

export type ApiAuditEventType =
  | "token.created"
  | "token.disabled"
  | "token.deleted"
  | "token.regenerated"
  | "token.used"
  | "token.rate_limited"
  | "token.invalid"
  | "token.scope_denied"
  | "token.permission_denied";

export type ApiTokenRecord = {
  id: string;
  userId: string;
  familyId: string;
  tokenPrefix: string;
  tokenHash: string;
  name: string;
  status: ApiTokenStatus;
  scopes: PublicApiScope[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  disabledAt: string;
  deletedAt: string;
  regeneratedAt: string;
  expiresAt: string;
  createdIp: string;
  lastUsedIp: string;
  usageDay: string;
  usageCountToday: number;
  lastUsedEndpoint: string;
  lastErrorAt: string;
  lastErrorCode: string;
};

export type ApiUsageSnapshot = {
  usedToday: number;
  remainingToday: number;
  limit: number;
  resetAt: string;
  trend: Array<{ date: string; count: number }>;
};
