import { describe, expect, it } from "vitest";
import { buildApiUsageTrend, normalizeScopes, serializeApiToken } from "@/lib/public-api/tokens";
import { PUBLIC_API_DAILY_LIMIT, type ApiTokenRecord } from "@/lib/public-api/types";

function token(overrides: Partial<ApiTokenRecord> = {}): ApiTokenRecord {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: "token-1",
    userId: "user-1",
    familyId: "family-1",
    tokenPrefix: "fc_live_abcd1234",
    tokenHash: "secret-hash",
    name: "Assistant",
    status: "active",
    scopes: ["read:profile", "read:coins"],
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:00.000Z",
    lastUsedAt: "",
    disabledAt: "",
    deletedAt: "",
    regeneratedAt: "",
    expiresAt: "",
    createdIp: "127.0.0.1",
    lastUsedIp: "",
    usageDay: today,
    usageCountToday: 7,
    lastUsedEndpoint: "",
    lastErrorAt: "",
    lastErrorCode: "",
    ...overrides,
  };
}

describe("public API token helpers", () => {
  it("normalizes scopes to known unique values", () => {
    expect(normalizeScopes(["read:coins", "write:chores", "read:coins", 1, "read:profile"])).toEqual([
      "read:coins",
      "read:profile",
    ]);
  });

  it("serializes token metadata without exposing hashes or raw secrets", () => {
    const serialized = serializeApiToken(token());
    expect(serialized.tokenPrefix).toBe("fc_live_abcd1234...");
    expect(JSON.stringify(serialized)).not.toContain("secret-hash");
    expect(JSON.stringify(serialized)).not.toContain("tokenHash");
  });

  it("reports today's usage and remaining daily quota", () => {
    const serialized = serializeApiToken(token({ usageCountToday: 999 }));
    expect(serialized.usage.limit).toBe(PUBLIC_API_DAILY_LIMIT);
    expect(serialized.usage.usedToday).toBe(999);
    expect(serialized.usage.remainingToday).toBe(1);
  });

  it("builds the usage trend from audit history and today's token usage counter", () => {
    const trend = buildApiUsageTrend({
      now: new Date("2026-06-16T15:00:00.000Z"),
      tokens: [token({ id: "active-token", usageDay: "2026-06-16", usageCountToday: 4 })],
      auditEvents: [
        {
          apiTokenId: "active-token",
          eventType: "token.used",
          createdAt: "2026-06-15T12:00:00.000Z",
        },
        {
          apiTokenId: "active-token",
          eventType: "token.used",
          createdAt: "2026-06-16T12:00:00.000Z",
        },
        {
          apiTokenId: "active-token",
          eventType: "token.created",
          createdAt: "2026-06-15T12:05:00.000Z",
        },
      ],
    });

    expect(trend.at(-2)).toEqual({ day: "2026-06-15", count: 1 });
    expect(trend.at(-1)).toEqual({ day: "2026-06-16", count: 4 });
  });
});
