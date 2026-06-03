"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type GhostSummary = {
  totalRecords: number;
  requested: number;
  dismissed: number;
  approved: number;
  rejected: number;
  converted: number;
  pendingReview: number;
  topTemplates: Array<{ title: string; count: number }>;
};

/**
 * Operator diagnostics for Smart Ghost Chores. Suggestions are generated on read and
 * not persisted, so "shown" is not tracked; this reports the persisted lifecycle:
 * requested, dismissed, approved/converted, and rejected, plus the top requested ideas.
 */
export function SupportGhostChoresPanel() {
  const [summary, setSummary] = useState<GhostSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/ghost-suggestions/summary", { cache: "no-store" });
      if (!response.ok) {
        setError(`Request failed (${response.status})`);
        return;
      }
      const data = (await response.json()) as { summary?: GhostSummary };
      setSummary(data.summary ?? null);
    } catch {
      setError("Could not load ghost chore metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="support-section">
      <div className="support-section-head">
        <h2>Smart Ghost Chores</h2>
        <Button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {summary ? (
        <>
          <ul className="support-metrics-grid">
            <li><strong>{summary.requested}</strong> requested</li>
            <li><strong>{summary.pendingReview}</strong> pending review</li>
            <li><strong>{summary.converted}</strong> approved / converted</li>
            <li><strong>{summary.rejected}</strong> rejected</li>
            <li><strong>{summary.dismissed}</strong> dismissed</li>
            <li><strong>{summary.totalRecords}</strong> total records</li>
          </ul>
          {summary.topTemplates.length > 0 ? (
            <div className="support-subsection">
              <h3>Top requested suggestions</h3>
              <ol>
                {summary.topTemplates.map((entry) => (
                  <li key={entry.title}>
                    {entry.title} — {entry.count}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <p className="small">No ghost chore activity recorded yet.</p>
      )}
    </section>
  );
}
