"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { SupportMetricsStrip, type SupportMetric } from "@/components/support-metrics-strip";

type ChoreUsageRow = {
  key: string;
  title: string;
  count: number;
  familyCount: number;
  routineCount: number;
};

type ChoreUsageSummary = {
  totalChores: number;
  uniqueChores: number;
  recurringChores: number;
  familyCount: number;
  usage: ChoreUsageRow[];
  truncated: boolean;
  scannedChores: number;
  excluded: { orphaned: number; deleted: number; starter: number };
};

function formatNumber(value: number) {
  return value.toLocaleString();
}

export function SupportChoreUsagePanel() {
  const [summary, setSummary] = useState<ChoreUsageSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/chores/usage", { cache: "no-store" });
      const data = (await response.json()) as ChoreUsageSummary & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Chore usage unavailable");
      }
      setSummary(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chore usage unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo<SupportMetric[]>(() => {
    return [
      {
        label: "Total Chores",
        value: summary ? formatNumber(summary.totalChores) : "-",
        detail: summary?.truncated ? "Capped scan (partial)" : "Live, real chores (excl. seed & deleted)",
        tone: "violet",
      },
      {
        label: "Unique Chores",
        value: summary ? formatNumber(summary.uniqueChores) : "-",
        detail: "Distinct chore titles (normalized)",
        tone: "sky",
      },
      {
        label: "Recurring Chores",
        value: summary ? formatNumber(summary.recurringChores) : "-",
        detail: "Repeat on a schedule (not routines)",
        tone: "emerald",
      },
      {
        label: "Families",
        value: summary ? formatNumber(summary.familyCount) : "-",
        detail: "Families with at least one chore",
        tone: "amber",
      },
    ];
  }, [summary]);

  const filteredUsage = useMemo(() => {
    const rows = summary?.usage ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter(
      (row) => row.title.toLowerCase().includes(normalized) || row.key.includes(normalized),
    );
  }, [summary, query]);

  const maxCount = filteredUsage.reduce((max, row) => Math.max(max, row.count), 0);

  const totalExcluded = summary
    ? summary.excluded.orphaned + summary.excluded.deleted + summary.excluded.starter
    : 0;

  return (
    <>
      <SupportMetricsStrip metrics={metrics} forceSingleRow />

      {summary && totalExcluded > 0 ? (
        <p className="px-1 text-xs text-slate-500">
          Scanned {formatNumber(summary.scannedChores)} chore records; excluded{" "}
          {formatNumber(totalExcluded)} non-real (
          {formatNumber(summary.excluded.starter)} onboarding,{" "}
          {formatNumber(summary.excluded.deleted)} deleted,{" "}
          {formatNumber(summary.excluded.orphaned)} orphaned from removed families).
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Most Common Chores</h3>
            <p className="text-sm text-slate-500">
              How often each chore is used across all families. Similar titles are grouped (case,
              punctuation, and words like &ldquo;your&rdquo;/&ldquo;the&rdquo; are ignored) so
              &ldquo;Clean Room&rdquo; and &ldquo;clean your room&rdquo; count as one chore.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex min-w-[220px] flex-col gap-1 text-sm font-semibold text-slate-700">
              Search chores
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                placeholder="Chore title"
              />
            </label>
            <Button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        <div className="p-4">
          {error ? <Alert>{error}</Alert> : null}
          {summary?.truncated ? (
            <Alert tone="warning">
              The chore collection is large; this reflects a capped scan and totals may be partial.
            </Alert>
          ) : null}
          {loading ? <div className="family-skeleton family-skeleton-row" /> : null}
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">Chore</th>
                <th className="px-3 py-2">Uses</th>
                <th className="px-3 py-2">Families</th>
                <th className="px-3 py-2" title="Number of routine templates that include this chore as a step">
                  Routines
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsage.map((row, index) => (
                <tr key={row.key} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-900">{row.title}</div>
                    <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-violet-400"
                        style={{ width: maxCount ? `${Math.max(4, (row.count / maxCount) * 100)}%` : "0%" }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{formatNumber(row.count)}</td>
                  <td className="px-3 py-2">{formatNumber(row.familyCount)}</td>
                  <td className="px-3 py-2">
                    {row.routineCount ? (
                      <span
                        className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
                        title={`In ${formatNumber(row.routineCount)} routine${row.routineCount === 1 ? "" : "s"}`}>
                        {formatNumber(row.routineCount)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filteredUsage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                    {query ? "No chores match the current search." : "No chores found."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
