"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { SupportMetricsStrip, type SupportMetric, type SupportMetricTone } from "@/components/support-metrics-strip";
import type { OperationMetricRecord, OperationSummary } from "@/lib/observability/summary";

type OperationsResponse = {
  summary: OperationSummary;
  records: OperationMetricRecord[];
  counts: { returned: number; matched: number; maxResponseRecords: number };
  generatedAt: string;
  error?: string;
  message?: string;
};

const AREAS = [
  "chores",
  "routines",
  "responsibility",
  "achievements",
  "notifications",
  "store",
  "feed",
  "support",
  "changelog",
] as const;

const RANGE_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "Last hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 14 days", hours: 24 * 14 },
];

const HEALTH_TONE: Record<OperationSummary["health"], SupportMetricTone> = {
  healthy: "emerald",
  warning: "amber",
  critical: "rose",
};

const RISK_REASON_COPY: Record<string, string> = {
  result_count_equals_requested_limit: "Result count hit the requested limit",
  next_page_exists_cursor_not_consumed: "More pages exist; cursor not consumed",
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value)} ms`;
}

function compactId(value: string) {
  if (!value) return "-";
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function userFamilyLabel(record: Pick<OperationMetricRecord, "userId" | "familyId">) {
  const parts: string[] = [];
  if (record.familyId) parts.push(`fam ${compactId(record.familyId)}`);
  if (record.userId) parts.push(`user ${compactId(record.userId)}`);
  return parts.length ? parts.join(" · ") : "-";
}

function statusBadgeClass(status: OperationMetricRecord["status"]) {
  if (status === "error") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (status === "slow") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
}

function healthCopy(health: OperationSummary["health"]) {
  if (health === "critical") return "Critical";
  if (health === "warning") return "Warning";
  return "Healthy";
}

function TableShell({
  title,
  columns,
  children,
  empty,
  minWidth = 900,
}: {
  title: string;
  columns: string[];
  children: React.ReactNode;
  empty: boolean;
  minWidth?: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {children}
            {empty ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-slate-500">
                  No matching operations in this window.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SupportOperationsPanel() {
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeHours, setRangeHours] = useState(24);
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [paginationRisksOnly, setPaginationRisksOnly] = useState(false);
  const [slowOnly, setSlowOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ rangeHours: String(rangeHours) });
      if (area) params.set("area", area);
      if (status) params.set("status", status);
      if (paginationRisksOnly) params.set("paginationRisksOnly", "true");
      if (slowOnly) params.set("slowOnly", "true");
      const response = await fetch(`/api/support/operations?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as OperationsResponse;
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Operation metrics unavailable");
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operation metrics unavailable");
    } finally {
      setLoading(false);
    }
  }, [rangeHours, area, status, paginationRisksOnly, slowOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const records = useMemo(() => data?.records ?? [], [data]);

  const healthMetrics = useMemo<SupportMetric[]>(() => {
    if (!summary) return [];
    return [
      {
        label: "System Health",
        value: healthCopy(summary.health),
        detail: `${summary.total} operation${summary.total === 1 ? "" : "s"} in window`,
        tone: HEALTH_TONE[summary.health],
      },
      {
        label: "API Latency (p95)",
        value: formatMs(summary.p95DurationMs),
        detail: `p50 ${formatMs(summary.p50DurationMs)} · max ${formatMs(summary.maxDurationMs)}`,
        tone: summary.p95DurationMs >= 1000 ? "amber" : "sky",
      },
      {
        label: "Slow Queries",
        value: summary.slowCount,
        detail: "≥ 1000 ms",
        tone: summary.slowCount > 0 ? "amber" : "emerald",
      },
      {
        label: "Pagination Risks",
        value: summary.paginationRiskCount,
        detail: "Page-size / cursor risk",
        tone: summary.paginationRiskCount > 0 ? "rose" : "emerald",
      },
      {
        label: "Recent Errors",
        value: summary.errorCount,
        detail: `${(summary.errorRate * 100).toFixed(1)}% error rate`,
        tone: summary.errorCount > 0 ? "rose" : "emerald",
      },
      {
        label: "Job Failures",
        value: summary.byArea.reduce((sum, entry) => sum + entry.errorCount, 0),
        detail: "Errors across all areas",
        tone: summary.errorCount > 0 ? "amber" : "emerald",
      },
    ];
  }, [summary]);

  const slowOperations = useMemo(
    () => [...records].filter((record) => record.slow).sort((a, b) => b.durationMs - a.durationMs).slice(0, 50),
    [records],
  );
  const paginationRisks = useMemo(() => records.filter((record) => record.paginationRisk).slice(0, 50), [records]);
  const recentErrors = useMemo(() => records.filter((record) => record.status === "error").slice(0, 50), [records]);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Time range
            <select
              value={rangeHours}
              onChange={(event) => setRangeHours(Number(event.target.value))}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              {RANGE_OPTIONS.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Area
            <select
              value={area}
              onChange={(event) => setArea(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              <option value="">All areas</option>
              {AREAS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              <option value="">All statuses</option>
              <option value="ok">OK</option>
              <option value="slow">Slow</option>
              <option value="error">Error</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={paginationRisksOnly}
              onChange={(event) => setPaginationRisksOnly(event.target.checked)}
            />
            Pagination risks only
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={slowOnly} onChange={(event) => setSlowOnly(event.target.checked)} />
            Slow operations only
          </label>
          <Button className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {data ? (
          <p className="mt-3 text-xs text-slate-500">
            {data.counts.matched} matched · showing {data.counts.returned} · updated {formatDate(data.generatedAt)}
          </p>
        ) : null}
      </section>

      {error ? <Alert>{error}</Alert> : null}

      {summary && summary.paginationRiskCount > 0 ? (
        <Alert tone="warning">
          {summary.paginationRiskCount} operation(s) hit a pagination risk — a query returned exactly its requested
          page size or left an unread next page. Increase the page size or paginate before this surfaces as a
          user-facing bug.
        </Alert>
      ) : null}

      {summary ? <SupportMetricsStrip metrics={healthMetrics} forceSingleRow /> : null}

      <TableShell
        title="Slow operations"
        columns={["Time", "Area", "Operation", "Duration", "Status", "User / Family"]}
        empty={slowOperations.length === 0}>
        {slowOperations.map((record) => (
          <tr key={record.id} className="border-t border-slate-100 align-top">
            <td className="px-3 py-2 whitespace-nowrap">{formatDate(record.createdAt)}</td>
            <td className="px-3 py-2">{record.area}</td>
            <td className="px-3 py-2">{record.operation}</td>
            <td className="px-3 py-2 font-semibold">{formatMs(record.durationMs)}</td>
            <td className="px-3 py-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
                {record.status}
              </span>
            </td>
            <td className="px-3 py-2 text-xs text-slate-500">{userFamilyLabel(record)}</td>
          </tr>
        ))}
      </TableShell>

      <TableShell
        title="Pagination risks"
        columns={["Time", "Area", "Operation", "Result count", "Requested limit", "Has next page", "Risk reason"]}
        empty={paginationRisks.length === 0}
        minWidth={1040}>
        {paginationRisks.map((record) => (
          <tr key={record.id} className="border-t border-slate-100 align-top">
            <td className="px-3 py-2 whitespace-nowrap">{formatDate(record.createdAt)}</td>
            <td className="px-3 py-2">{record.area}</td>
            <td className="px-3 py-2">{record.operation}</td>
            <td className="px-3 py-2 font-semibold">{record.resultCount ?? "-"}</td>
            <td className="px-3 py-2">{record.requestedLimit ?? "-"}</td>
            <td className="px-3 py-2">{record.hasNextPage ? "Yes" : "No"}</td>
            <td className="px-3 py-2 text-xs text-slate-600">
              {RISK_REASON_COPY[record.riskReason] ?? record.riskReason ?? "-"}
            </td>
          </tr>
        ))}
      </TableShell>

      <TableShell
        title="Recent errors"
        columns={["Time", "Area", "Operation", "Error code", "User / Family"]}
        empty={recentErrors.length === 0}>
        {recentErrors.map((record) => (
          <tr key={record.id} className="border-t border-slate-100 align-top">
            <td className="px-3 py-2 whitespace-nowrap">{formatDate(record.createdAt)}</td>
            <td className="px-3 py-2">{record.area}</td>
            <td className="px-3 py-2">{record.operation}</td>
            <td className="px-3 py-2 text-rose-700">{record.errorCode || "-"}</td>
            <td className="px-3 py-2 text-xs text-slate-500">{userFamilyLabel(record)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
