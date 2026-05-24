import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiToken,
  currentRateLimitResetIso,
  getClientIp,
  incrementTokenUsage,
  markTokenError,
  recordApiAudit,
} from "@/lib/public-api/tokens";
import {
  PUBLIC_API_DAILY_LIMIT,
  type ApiAuditEventType,
  type ApiErrorCode,
  type ApiTokenRecord,
  type PublicApiScope,
} from "@/lib/public-api/types";

export type PublicApiContext = {
  requestId: string;
  token: ApiTokenRecord;
  rateLimit: {
    limit: number;
    used: number;
    remaining: number;
    resetAt: string;
  };
};

type HandlerResult = Response | NextResponse;

export function publicApiError(
  code: ApiErrorCode | string,
  message: string,
  status: number,
  requestId: string,
  rateLimit?: PublicApiContext["rateLimit"],
) {
  return withPublicApiHeaders(
    NextResponse.json({ error: { code, message, requestId } }, { status }),
    requestId,
    rateLimit,
  );
}

export function withPublicApiHeaders<T extends Response>(
  response: T,
  requestId: string,
  rateLimit?: PublicApiContext["rateLimit"],
) {
  response.headers.set("X-Request-Id", requestId);
  if (rateLimit) {
    response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
    response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    response.headers.set("X-RateLimit-Reset", rateLimit.resetAt);
    response.headers.set("X-RateLimit-Used", String(rateLimit.used));
  }
  return response;
}

export async function withPublicApi(
  request: NextRequest,
  scopes: PublicApiScope[],
  handler: (context: PublicApiContext) => Promise<HandlerResult>,
) {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  const startedAt = Date.now();
  const ipAddress = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || "";
  const endpoint = request.nextUrl.pathname;
  const method = request.method;
  let token: ApiTokenRecord | null = null;
  let statusCode = 500;
  let errorCategory = "";
  let rateLimit: PublicApiContext["rateLimit"] | undefined;

  try {
    const authorization = request.headers.get("authorization") || "";
    const rawToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    if (!rawToken) {
      statusCode = 401;
      errorCategory = "missing_token";
      await recordApiAudit({
        eventType: "token.invalid",
        endpoint,
        method,
        statusCode,
        ipAddress,
        userAgent,
        requestId,
        metadata: { reason: errorCategory },
      });
      return publicApiError("unauthorized", "Bearer API token required.", statusCode, requestId);
    }

    token = await authenticateApiToken(rawToken);
    if (!token) {
      statusCode = 401;
      errorCategory = "invalid_token";
      await recordApiAudit({
        eventType: "token.invalid",
        endpoint,
        method,
        statusCode,
        ipAddress,
        userAgent,
        requestId,
        metadata: { reason: errorCategory },
      });
      return publicApiError("unauthorized", "Invalid API token.", statusCode, requestId);
    }

    const usedToday = token.usageDay === new Date().toISOString().slice(0, 10) ? token.usageCountToday : 0;
    rateLimit = {
      limit: PUBLIC_API_DAILY_LIMIT,
      used: usedToday,
      remaining: Math.max(0, PUBLIC_API_DAILY_LIMIT - usedToday),
      resetAt: currentRateLimitResetIso(),
    };

    if (token.status !== "active") {
      statusCode = 401;
      errorCategory = token.status === "deleted" ? "deleted_token" : "disabled_token";
      await markTokenError({ token, code: errorCategory });
      await recordApiAudit(auditInput(token, "token.invalid", request, requestId, statusCode, ipAddress, userAgent, {
        reason: errorCategory,
      }));
      return publicApiError("unauthorized", "API token is not active.", statusCode, requestId, rateLimit);
    }

    const missingScope = scopes.find((scope) => !token?.scopes.includes(scope));
    if (missingScope) {
      statusCode = 403;
      errorCategory = "scope_denied";
      await markTokenError({ token, code: errorCategory });
      await recordApiAudit(
        auditInput(token, "token.scope_denied", request, requestId, statusCode, ipAddress, userAgent, {
          requiredScope: missingScope,
        }),
      );
      return publicApiError("forbidden", "API token is missing a required scope.", statusCode, requestId, rateLimit);
    }

    if (usedToday >= PUBLIC_API_DAILY_LIMIT) {
      statusCode = 429;
      errorCategory = "rate_limit_exceeded";
      await markTokenError({ token, code: errorCategory });
      await recordApiAudit(auditInput(token, "token.rate_limited", request, requestId, statusCode, ipAddress, userAgent));
      return publicApiError(
        "rate_limit_exceeded",
        "Daily API request limit exceeded.",
        statusCode,
        requestId,
        rateLimit,
      );
    }

    const usage = await incrementTokenUsage({ token, endpoint, ipAddress });
    rateLimit = {
      limit: PUBLIC_API_DAILY_LIMIT,
      used: usage.used,
      remaining: usage.remaining,
      resetAt: usage.resetAt,
    };

    const response = await handler({ requestId, token, rateLimit });
    statusCode = response.status;
    if (statusCode === 403) {
      errorCategory = "permission_denied";
      await markTokenError({ token, code: errorCategory });
      await recordApiAudit(auditInput(token, "token.permission_denied", request, requestId, statusCode, ipAddress, userAgent));
    } else {
      await recordApiAudit(auditInput(token, "token.used", request, requestId, statusCode, ipAddress, userAgent));
    }
    return withPublicApiHeaders(response, requestId, rateLimit);
  } catch (error) {
    errorCategory = error instanceof Error ? error.message.slice(0, 80) : "internal_error";
    statusCode = 500;
    if (token) {
      await markTokenError({ token, code: "internal_error" }).catch(() => undefined);
    }
    return publicApiError("internal_error", "Public API request failed.", statusCode, requestId, rateLimit);
  } finally {
    console.log("[PUBLIC_API_REQUEST]", {
      requestId,
      tokenPrefix: token?.tokenPrefix,
      userId: token?.userId,
      familyId: token?.familyId,
      method,
      path: endpoint,
      statusCode,
      latencyMs: Date.now() - startedAt,
      ipAddress,
      userAgent,
      rateLimitRemaining: rateLimit?.remaining,
      errorCategory,
    });
  }
}

function auditInput(
  token: ApiTokenRecord,
  eventType: ApiAuditEventType,
  request: NextRequest,
  requestId: string,
  statusCode: number,
  ipAddress: string,
  userAgent: string,
  metadata?: Record<string, unknown>,
) {
  return {
    eventType,
    userId: token.userId,
    familyId: token.familyId,
    apiTokenId: token.id,
    endpoint: request.nextUrl.pathname,
    method: request.method,
    statusCode,
    ipAddress,
    userAgent,
    requestId,
    metadata,
  };
}
