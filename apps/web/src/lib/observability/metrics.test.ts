import { describe, expect, it } from "vitest";
import {
  buildOperationMetricFields,
  computePaginationRisk,
  resolveOperationStatus,
  sanitizeMetadata,
} from "@/lib/observability/metrics";

describe("computePaginationRisk", () => {
  it("flags risk when the result count equals the requested limit", () => {
    expect(computePaginationRisk({ requestedLimit: 50, resultCount: 50 })).toEqual({
      paginationRisk: true,
      riskReason: "result_count_equals_requested_limit",
    });
  });

  it("does not flag risk when the result count is below the requested limit", () => {
    expect(computePaginationRisk({ requestedLimit: 50, resultCount: 12 })).toEqual({
      paginationRisk: false,
      riskReason: "",
    });
  });

  it("flags risk when a next page exists but the cursor was not consumed", () => {
    expect(computePaginationRisk({ hasNextPage: true, cursorConsumed: false })).toEqual({
      paginationRisk: true,
      riskReason: "next_page_exists_cursor_not_consumed",
    });
  });

  it("does not flag risk when a next page exists and the cursor was consumed", () => {
    expect(computePaginationRisk({ hasNextPage: true, cursorConsumed: true })).toEqual({
      paginationRisk: false,
      riskReason: "",
    });
  });

  it("does not flag a full page when the caller surfaced pagination (cursor consumed)", () => {
    // A properly-paginated endpoint (e.g. the feed) returns exactly the page
    // size on every non-last page and exposes hasMore. That is expected, not a
    // silent truncation, so it must not trip the limit-equality rule.
    expect(
      computePaginationRisk({ requestedLimit: 20, resultCount: 20, hasNextPage: true, cursorConsumed: true }),
    ).toEqual({ paginationRisk: false, riskReason: "" });
  });

  it("ignores a zero or missing requested limit for the equality rule", () => {
    expect(computePaginationRisk({ requestedLimit: 0, resultCount: 0 }).paginationRisk).toBe(false);
    expect(computePaginationRisk({ resultCount: 0 }).paginationRisk).toBe(false);
  });

  it("prefers the limit-equality reason when both conditions hold", () => {
    expect(
      computePaginationRisk({ requestedLimit: 20, resultCount: 20, hasNextPage: true, cursorConsumed: false }),
    ).toEqual({ paginationRisk: true, riskReason: "result_count_equals_requested_limit" });
  });
});

describe("resolveOperationStatus", () => {
  it("respects an explicit status", () => {
    expect(resolveOperationStatus({ area: "chores", operation: "list", durationMs: 9000, status: "ok" })).toBe("ok");
  });

  it("derives error when an error code is present", () => {
    expect(resolveOperationStatus({ area: "chores", operation: "list", durationMs: 5, errorCode: "boom" })).toBe(
      "error",
    );
  });

  it("derives slow when the duration crosses the threshold", () => {
    expect(resolveOperationStatus({ area: "chores", operation: "list", durationMs: 1500 })).toBe("slow");
    expect(resolveOperationStatus({ area: "chores", operation: "list", durationMs: 200 })).toBe("ok");
  });
});

describe("sanitizeMetadata", () => {
  it("drops keys that could carry sensitive personal data or free text", () => {
    const result = sanitizeMetadata({
      description: "Take out the trash for Timmy",
      email: "kid@example.com",
      childName: "Timmy",
      authToken: "secret-token",
      message: "private note",
      body: "raw request body",
      page: 3,
    });
    expect(result).toEqual({ page: 3 });
  });

  it("truncates long string values and keeps short primitives", () => {
    const result = sanitizeMetadata({
      label: "x".repeat(500),
      count: 12,
      flag: true,
      nothing: null,
    });
    expect((result.label as string).length).toBe(120);
    expect(result.count).toBe(12);
    expect(result.flag).toBe(true);
    expect(result.nothing).toBeNull();
  });

  it("drops nested objects, arrays, and invalid keys", () => {
    const result = sanitizeMetadata({
      nested: { secret: "value" },
      list: [1, 2, 3],
      "bad key!": 1,
      ok: 5,
    });
    expect(result).toEqual({ ok: 5 });
  });

  it("caps the number of keys", () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 50; i += 1) {
      input[`k${i}`] = i;
    }
    expect(Object.keys(sanitizeMetadata(input)).length).toBe(20);
  });
});

describe("buildOperationMetricFields", () => {
  it("never writes sensitive data passed via metadata into the metric document", () => {
    const fields = buildOperationMetricFields({
      area: "chores",
      operation: "list",
      durationMs: 1200,
      resultCount: 50,
      requestedLimit: 50,
      familyId: "fam-1",
      userId: "user-1",
      metadata: {
        description: "Clean Timmy's room",
        email: "parent@example.com",
        page: 2,
      },
    });

    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain("Clean Timmy");
    expect(serialized).not.toContain("parent@example.com");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("email");

    // The benign, non-sensitive value survives.
    expect(serialized).toContain("page");
    // Risk + status are computed and stored.
    expect(fields.paginationRisk).toEqual({ booleanValue: true });
    expect(fields.slow).toEqual({ booleanValue: true });
    expect(fields.status).toEqual({ stringValue: "slow" });
    expect(fields.area).toEqual({ stringValue: "chores" });
  });

  it("stores an expiry timestamp inside the retention window", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const fields = buildOperationMetricFields({ area: "feed", operation: "list", durationMs: 10 }, now);
    const expiresAt = (fields.expiresAt as { timestampValue: string }).timestampValue;
    const createdAt = (fields.createdAt as { timestampValue: string }).timestampValue;
    const days = (Date.parse(expiresAt) - Date.parse(createdAt)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(14);
    expect(days).toBeLessThanOrEqual(30);
  });
});
