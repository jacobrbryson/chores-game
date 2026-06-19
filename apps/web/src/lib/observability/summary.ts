import { SLOW_OPERATION_THRESHOLD_MS } from "@/lib/observability/metrics";

// Normalized, client-safe shape of one operation metric record. This is exactly
// what the Operations API returns and what the dashboard renders — no Firestore
// wrapper types, no raw request data.
export type OperationMetricRecord = {
  id: string;
  area: string;
  operation: string;
  durationMs: number;
  status: "ok" | "error" | "slow";
  slow: boolean;
  resultCount: number | null;
  requestedLimit: number | null;
  hasNextPage: boolean;
  paginationRisk: boolean;
  riskReason: string;
  errorCode: string;
  familyId: string;
  userId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type OperationHealth = "healthy" | "warning" | "critical";

export type OperationSummary = {
  health: OperationHealth;
  total: number;
  p95DurationMs: number;
  p50DurationMs: number;
  maxDurationMs: number;
  slowCount: number;
  errorCount: number;
  errorRate: number;
  paginationRiskCount: number;
  byArea: Array<{ area: string; total: number; errorCount: number; slowCount: number; paginationRiskCount: number }>;
};

// Health thresholds. Tunable, but chosen so the recurring page-size bug always
// surfaces at least a "warning".
const LATENCY_WARNING_MS = SLOW_OPERATION_THRESHOLD_MS; // p95 at/above this → not healthy
const LATENCY_CRITICAL_MS = 3000;
const ERROR_RATE_WARNING = 0.02;
const ERROR_RATE_CRITICAL = 0.1;
const SLOW_COUNT_WARNING = 5;
const REPEATED_FAILURE_CRITICAL = 10;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Compute the dashboard health summary from a window of metric records.
 *
 * - Healthy: p95 latency < 1000ms, few slow queries, low error rate.
 * - Warning: pagination risks present, slow queries, or elevated latency.
 * - Critical: high error rate or repeated failures.
 */
export function summarizeOperationMetrics(records: OperationMetricRecord[]): OperationSummary {
  const total = records.length;
  const durations = records.map((record) => record.durationMs).filter((value) => Number.isFinite(value));
  const slowCount = records.filter((record) => record.slow || record.durationMs >= SLOW_OPERATION_THRESHOLD_MS).length;
  const errorCount = records.filter((record) => record.status === "error").length;
  const paginationRiskCount = records.filter((record) => record.paginationRisk).length;
  const errorRate = total === 0 ? 0 : errorCount / total;
  const p95DurationMs = percentile(durations, 95);
  const p50DurationMs = percentile(durations, 50);
  const maxDurationMs = durations.reduce((max, value) => Math.max(max, value), 0);

  const byAreaMap = new Map<string, { area: string; total: number; errorCount: number; slowCount: number; paginationRiskCount: number }>();
  for (const record of records) {
    const entry = byAreaMap.get(record.area) ?? {
      area: record.area,
      total: 0,
      errorCount: 0,
      slowCount: 0,
      paginationRiskCount: 0,
    };
    entry.total += 1;
    if (record.status === "error") entry.errorCount += 1;
    if (record.slow || record.durationMs >= SLOW_OPERATION_THRESHOLD_MS) entry.slowCount += 1;
    if (record.paginationRisk) entry.paginationRiskCount += 1;
    byAreaMap.set(record.area, entry);
  }

  let health: OperationHealth = "healthy";
  const isCritical =
    errorRate >= ERROR_RATE_CRITICAL ||
    errorCount >= REPEATED_FAILURE_CRITICAL ||
    p95DurationMs >= LATENCY_CRITICAL_MS;
  const isWarning =
    paginationRiskCount > 0 ||
    slowCount >= SLOW_COUNT_WARNING ||
    p95DurationMs >= LATENCY_WARNING_MS ||
    errorRate >= ERROR_RATE_WARNING;
  if (isCritical) {
    health = "critical";
  } else if (isWarning) {
    health = "warning";
  }

  return {
    health,
    total,
    p95DurationMs,
    p50DurationMs,
    maxDurationMs,
    slowCount,
    errorCount,
    errorRate,
    paginationRiskCount,
    byArea: [...byAreaMap.values()].sort((a, b) => b.total - a.total),
  };
}
