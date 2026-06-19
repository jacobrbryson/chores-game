import { describe, expect, it } from "vitest";
import { percentile, summarizeOperationMetrics, type OperationMetricRecord } from "@/lib/observability/summary";

function record(overrides: Partial<OperationMetricRecord>): OperationMetricRecord {
  return {
    id: Math.random().toString(36).slice(2),
    area: "chores",
    operation: "list",
    durationMs: 100,
    status: "ok",
    slow: false,
    resultCount: 10,
    requestedLimit: 50,
    hasNextPage: false,
    paginationRisk: false,
    riskReason: "",
    errorCode: "",
    familyId: "",
    userId: "",
    metadata: {},
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns 0 for an empty set", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("computes the p95 of a range", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
  });
});

describe("summarizeOperationMetrics", () => {
  it("reports healthy when latency, slow count, and errors are all low", () => {
    const summary = summarizeOperationMetrics(
      Array.from({ length: 30 }, () => record({ durationMs: 120 })),
    );
    expect(summary.health).toBe("healthy");
    expect(summary.errorCount).toBe(0);
    expect(summary.paginationRiskCount).toBe(0);
  });

  it("reports warning when any pagination risk is present", () => {
    const records = [
      ...Array.from({ length: 20 }, () => record({ durationMs: 100 })),
      record({ durationMs: 100, paginationRisk: true, riskReason: "result_count_equals_requested_limit" }),
    ];
    const summary = summarizeOperationMetrics(records);
    expect(summary.health).toBe("warning");
    expect(summary.paginationRiskCount).toBe(1);
  });

  it("reports warning on elevated p95 latency", () => {
    // p95 of these is ~1500ms (>= 1000) but well under the 3000ms critical bar,
    // and there are no errors, so the window should be a warning.
    const records = Array.from({ length: 20 }, () => record({ durationMs: 1500, slow: true }));
    const summary = summarizeOperationMetrics(records);
    expect(summary.health).toBe("warning");
    expect(summary.p95DurationMs).toBeGreaterThanOrEqual(1000);
  });

  it("reports critical when the error rate is high", () => {
    const records = [
      ...Array.from({ length: 5 }, () => record({ status: "error", errorCode: "boom" })),
      ...Array.from({ length: 5 }, () => record({})),
    ];
    const summary = summarizeOperationMetrics(records);
    expect(summary.health).toBe("critical");
    expect(summary.errorCount).toBe(5);
    expect(summary.errorRate).toBe(0.5);
  });

  it("reports critical on repeated failures even at lower rates", () => {
    const records = [
      ...Array.from({ length: 12 }, () => record({ status: "error", errorCode: "boom" })),
      ...Array.from({ length: 200 }, () => record({})),
    ];
    const summary = summarizeOperationMetrics(records);
    expect(summary.health).toBe("critical");
  });

  it("groups counts by area", () => {
    const summary = summarizeOperationMetrics([
      record({ area: "chores" }),
      record({ area: "chores", paginationRisk: true }),
      record({ area: "feed", status: "error", errorCode: "x" }),
    ]);
    const chores = summary.byArea.find((entry) => entry.area === "chores");
    const feed = summary.byArea.find((entry) => entry.area === "feed");
    expect(chores?.total).toBe(2);
    expect(chores?.paginationRiskCount).toBe(1);
    expect(feed?.errorCount).toBe(1);
  });
});
