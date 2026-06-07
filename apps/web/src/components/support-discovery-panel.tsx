"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";

// Operator-only diagnostics for the Discovery / What's New system. English-only,
// consistent with the rest of the /support console. Shows system health, no
// child-identifying detail beyond opaque uids needed for triage.

type DiscoveryDiagnostics = {
  healthy: boolean;
  unavailable?: boolean;
  registeredSections?: string[];
  totalStateRecords?: number;
  profilesWithDiscoveryState?: number;
  recentUpdatesLast7Days?: number;
  countsBySection?: Record<string, number>;
  recentUpdatesPreview?: Array<{ sectionKey: string; seenByUid: string; updatedAt: string }>;
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function SupportDiscoveryPanel() {
  const [data, setData] = useState<DiscoveryDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/discovery", { cache: "no-store" });
      const payload = (await response.json()) as DiscoveryDiagnostics & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Discovery diagnostics unavailable");
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Discovery diagnostics unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Discovery / What&apos;s New</h3>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading discovery diagnostics...</p> : null}
      {error ? <Alert tone="warning">{error}</Alert> : null}

      {!loading && data ? (
        data.unavailable ? (
          <Alert tone="warning">Discovery diagnostics are temporarily unavailable.</Alert>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-lg font-bold text-slate-800">{data.totalStateRecords ?? 0}</div>
                <div className="text-xs text-slate-500">State records</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-lg font-bold text-slate-800">{data.profilesWithDiscoveryState ?? 0}</div>
                <div className="text-xs text-slate-500">Profiles tracked</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-lg font-bold text-slate-800">{data.recentUpdatesLast7Days ?? 0}</div>
                <div className="text-xs text-slate-500">Updates (7d)</div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Seen-state by section
              </h4>
              <div className="flex flex-wrap gap-2">
                {(data.registeredSections ?? []).map((section) => (
                  <span
                    key={section}
                    className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {section}: {data.countsBySection?.[section] ?? 0}
                  </span>
                ))}
              </div>
            </div>

            {data.recentUpdatesPreview && data.recentUpdatesPreview.length > 0 ? (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recent seen updates
                </h4>
                <ul className="space-y-1 text-xs text-slate-600">
                  {data.recentUpdatesPreview.map((row, index) => (
                    <li key={`${row.seenByUid}-${row.sectionKey}-${index}`} className="flex justify-between gap-3">
                      <span className="truncate font-mono">{row.seenByUid || "?"}</span>
                      <span>{row.sectionKey}</span>
                      <span className="text-slate-400">{formatDate(row.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}
