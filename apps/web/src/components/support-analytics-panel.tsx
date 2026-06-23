"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";

type AnalyticsEvent = {
  id: string;
  event: string;
  timestamp: string;
  familyId?: string;
  userId?: string;
  role?: string;
  platform?: string;
  metadata: Record<string, string | number | boolean | null>;
};

type AnalyticsSummary = {
  scanned: number;
  scanCap: number;
  capped: boolean;
  totalEvents: number;
  eventsToday: number;
  topEvents: Array<{ event: string; count: number }>;
  recentEvents: AnalyticsEvent[];
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function compactId(value: string | undefined) {
  if (!value) return "-";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function describeMetadata(metadata: AnalyticsEvent["metadata"]) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return "-";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function SupportAnalyticsPanel() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/support/analytics", { cache: "no-store" });
        const data = (await response.json()) as { summary?: AnalyticsSummary; error?: string };
        if (!response.ok || !data.summary) {
          throw new Error(data.error || "Analytics unavailable");
        }
        setSummary(data.summary);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Analytics unavailable");
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Analytics Events</h3>
        <p className="text-sm text-slate-500">
          Validation view over the centralized analytics event pipeline. Confirms events are being
          collected reliably — dashboards, charts, and family health scoring come later. Aggregated
          from the most recent events (capped scan).
        </p>
        {error ? <Alert className="mt-2">{error}</Alert> : null}

        {summary ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Total Events" value={summary.totalEvents} detail={summary.capped ? `Capped at ${summary.scanCap}` : "All recorded events"} />
              <StatCard label="Events Today" value={summary.eventsToday} detail="Since local midnight" />
              <StatCard label="Distinct Event Types" value={summary.topEvents.length} detail="In the loaded scan" />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-700">Top Events</h4>
                <ul className="mt-1 text-sm text-slate-600">
                  {summary.topEvents.map((entry) => (
                    <li key={entry.event} className="flex justify-between border-b border-slate-100 py-1">
                      <span className="truncate font-mono text-xs">{entry.event}</span>
                      <span>{entry.count}</span>
                    </li>
                  ))}
                  {summary.topEvents.length === 0 ? (
                    <li className="py-1 text-slate-500">No events recorded yet.</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </>
        ) : !error ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : null}
      </section>

      {summary ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-900">Recent Events</h3>
            <p className="text-sm text-slate-500">Most recent {summary.recentEvents.length} events.</p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Platform</th>
                  <th className="px-3 py-2">Metadata</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentEvents.map((event) => (
                  <tr key={event.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono text-xs text-slate-900">{event.event}</td>
                    <td className="px-3 py-2">{compactId(event.userId)}</td>
                    <td className="px-3 py-2">{compactId(event.familyId)}</td>
                    <td className="px-3 py-2">{event.role || "-"}</td>
                    <td className="px-3 py-2">{event.platform || "-"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{describeMetadata(event.metadata)}</td>
                    <td className="px-3 py-2">{formatDate(event.timestamp)}</td>
                  </tr>
                ))}
                {summary.recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      No events recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
    </div>
  );
}
