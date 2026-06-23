"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";

type FamilyHealthState = "healthy" | "at_risk" | "inactive";

type FamilyHealthRow = {
  familyId: string;
  familyName: string;
  state: FamilyHealthState;
  score: number;
  reasons: string[];
  lastParentActivity: string | null;
  lastChildActivity: string | null;
  lastActivity: string | null;
  pendingApprovals: number;
  choresCompletedThisWeek: number;
  avgApprovalHours: number | null;
  totalEventsRecent: number;
};

type FamilyHealthOverview = {
  generatedAt: string;
  windowDays: number;
  thresholds: { healthyMin: number; atRiskMin: number };
  scannedEvents: number;
  eventScanCap: number;
  capped: boolean;
  totals: { families: number; healthy: number; atRisk: number; inactive: number };
  families: FamilyHealthRow[];
};

type AnalyticsEvent = {
  id: string;
  event: string;
  timestamp: string;
  role?: string;
  metadata: Record<string, string | number | boolean | null>;
};

type FamilyHealthDetail = {
  familyId: string;
  familyName: string;
  windowDays: number;
  score: number;
  state: FamilyHealthState;
  reasons: string[];
  breakdown: {
    parentActivity: number;
    childActivity: number;
    coreLoop: number;
    engagementDepth: number;
  };
  pendingApprovals: number;
  completionTrend: Array<{ date: string; completed: number; approved: number }>;
  parentActivity: { lastActive: string | null; eventsInWindow: number };
  childActivity: { lastActive: string | null; eventsInWindow: number };
  routineActivity: { created: number; completed: number };
  responsibilityXpEvents: number;
  recentEvents: AnalyticsEvent[];
};

const STATE_LABEL: Record<FamilyHealthState, string> = {
  healthy: "Healthy",
  at_risk: "At Risk",
  inactive: "Inactive",
};

const STATE_BADGE: Record<FamilyHealthState, string> = {
  healthy: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  at_risk: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  inactive: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

function formatRelative(value: string | null) {
  if (!value) return "Never";
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return value;
  const days = Math.floor((Date.now() - millis) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function formatApprovalTime(hours: number | null) {
  if (hours === null) return "-";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function SupportFamilyHealthPanel() {
  const [overview, setOverview] = useState<FamilyHealthOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<FamilyHealthDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/support/analytics/family-health", { cache: "no-store" });
        const data = (await response.json()) as { overview?: FamilyHealthOverview; error?: string };
        if (!response.ok || !data.overview) {
          throw new Error(data.error || "Family health unavailable");
        }
        setOverview(data.overview);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Family health unavailable");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function toggleRow(familyId: string) {
    if (expanded === familyId) {
      setExpanded(null);
      return;
    }
    setExpanded(familyId);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/support/analytics/family-health?familyId=${encodeURIComponent(familyId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { detail?: FamilyHealthDetail; error?: string };
      if (!response.ok || !data.detail) {
        throw new Error(data.error || "Family detail unavailable");
      }
      setDetail(data.detail);
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "Family detail unavailable");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Family Health</h3>
        <p className="text-sm text-slate-500">
          Operational view of which families are thriving, at risk, or inactive — scored from the
          analytics event pipeline over a {overview?.windowDays ?? 7}-day window. Internal only; never
          shown to families. Click a row to drill into a family.
        </p>
        {error ? <Alert className="mt-2">{error}</Alert> : null}
        {loading ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : null}

        {overview ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Families" value={overview.totals.families} tone="slate" />
              <StatCard label="Healthy" value={overview.totals.healthy} tone="emerald" />
              <StatCard label="At Risk" value={overview.totals.atRisk} tone="amber" />
              <StatCard label="Inactive" value={overview.totals.inactive} tone="rose" />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Scanned {overview.scannedEvents.toLocaleString()} events
              {overview.capped ? ` (capped at ${overview.eventScanCap.toLocaleString()})` : ""}. Thresholds:
              Healthy ≥ {overview.thresholds.healthyMin}, At Risk ≥ {overview.thresholds.atRiskMin}.
            </p>
          </>
        ) : null}
      </section>

      {overview ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <h3 className="text-lg font-bold text-slate-900">Families</h3>
            <p className="text-sm text-slate-500">
              Worst-first. Risk reasons explain why a family is flagged.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Parent</th>
                  <th className="px-3 py-2">Child</th>
                  <th className="px-3 py-2">Pending</th>
                  <th className="px-3 py-2">Done/wk</th>
                  <th className="px-3 py-2">Avg Appr.</th>
                  <th className="px-3 py-2">Risk Reasons</th>
                </tr>
              </thead>
              <tbody>
                {overview.families.map((row) => (
                  <FamilyRow
                    key={row.familyId}
                    row={row}
                    expanded={expanded === row.familyId}
                    detail={expanded === row.familyId ? detail : null}
                    detailError={expanded === row.familyId ? detailError : ""}
                    detailLoading={expanded === row.familyId ? detailLoading : false}
                    onToggle={() => void toggleRow(row.familyId)}
                  />
                ))}
                {overview.families.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                      No families found.
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

function FamilyRow({
  row,
  expanded,
  detail,
  detailError,
  detailLoading,
  onToggle,
}: {
  row: FamilyHealthRow;
  expanded: boolean;
  detail: FamilyHealthDetail | null;
  detailError: string;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-slate-100 align-top transition-colors hover:bg-sky-50/50"
        onClick={onToggle}>
        <td className="px-3 py-2">
          <div className="font-semibold text-slate-900">{row.familyName}</div>
          <div className="font-mono text-xs text-slate-400">{row.familyId}</div>
        </td>
        <td className="px-3 py-2">
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATE_BADGE[row.state]}`}>
            {STATE_LABEL[row.state]}
          </span>
        </td>
        <td className="px-3 py-2 font-semibold text-slate-900">{row.score}</td>
        <td className="px-3 py-2 text-slate-600">{formatRelative(row.lastParentActivity)}</td>
        <td className="px-3 py-2 text-slate-600">{formatRelative(row.lastChildActivity)}</td>
        <td className="px-3 py-2 text-slate-600">{row.pendingApprovals}</td>
        <td className="px-3 py-2 text-slate-600">{row.choresCompletedThisWeek}</td>
        <td className="px-3 py-2 text-slate-600">{formatApprovalTime(row.avgApprovalHours)}</td>
        <td className="px-3 py-2 text-xs text-slate-500">
          {row.reasons.length ? (
            <ul className="list-disc pl-4">
              {row.reasons.slice(0, 2).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
              {row.reasons.length > 2 ? <li>+{row.reasons.length - 2} more</li> : null}
            </ul>
          ) : (
            <span className="text-emerald-600">Core loop healthy</span>
          )}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={9} className="px-4 py-4">
            {detailLoading ? <p className="text-sm text-slate-500">Loading family detail…</p> : null}
            {detailError ? <Alert>{detailError}</Alert> : null}
            {detail ? <FamilyDetail detail={detail} /> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FamilyDetail({ detail }: { detail: FamilyHealthDetail }) {
  const maxTrend = Math.max(1, ...detail.completionTrend.map((day) => day.completed + day.approved));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreBar label="Parent Activity" value={detail.breakdown.parentActivity} />
        <ScoreBar label="Child Activity" value={detail.breakdown.childActivity} />
        <ScoreBar label="Core Loop" value={detail.breakdown.coreLoop} />
        <ScoreBar label="Engagement Depth" value={detail.breakdown.engagementDepth} />
      </div>

      {detail.reasons.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Detected risk reasons</div>
          <ul className="mt-1 list-disc pl-5">
            {detail.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-sm font-semibold text-slate-700">Completion trend ({detail.windowDays}d)</div>
          <div className="mt-2 flex items-end gap-1" style={{ height: 80 }}>
            {detail.completionTrend.map((day) => (
              <div key={day.date} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                <div
                  className="w-full rounded-t bg-sky-400"
                  style={{ height: `${(day.completed / maxTrend) * 64}px` }}
                  title={`${day.date}: ${day.completed} completed, ${day.approved} approved`}
                />
                <span className="text-[10px] text-slate-400">{day.date.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-slate-400">Bars = chores completed per day.</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <SummaryStat label="Pending approvals" value={detail.pendingApprovals} />
          <SummaryStat
            label="Parent events (wk)"
            value={detail.parentActivity.eventsInWindow}
            detail={`Last: ${formatRelative(detail.parentActivity.lastActive)}`}
          />
          <SummaryStat
            label="Child events (wk)"
            value={detail.childActivity.eventsInWindow}
            detail={`Last: ${formatRelative(detail.childActivity.lastActive)}`}
          />
          <SummaryStat
            label="Routines"
            value={detail.routineActivity.completed}
            detail={`${detail.routineActivity.created} created`}
          />
          <SummaryStat label="Pillar XP events (wk)" value={detail.responsibilityXpEvents} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
          Recent analytics events
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 uppercase text-slate-400">
              <tr>
                <th className="px-3 py-1.5">Event</th>
                <th className="px-3 py-1.5">Role</th>
                <th className="px-3 py-1.5">When</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentEvents.map((event) => (
                <tr key={event.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-mono text-slate-800">{event.event}</td>
                  <td className="px-3 py-1.5 text-slate-500">{event.role || "-"}</td>
                  <td className="px-3 py-1.5 text-slate-500">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
              {detail.recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                    No events recorded for this family.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-slate-900">{value.toLocaleString()}</div>
      {detail ? <div className="text-xs text-slate-400">{detail}</div> : null}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50/60",
  emerald: "border-emerald-200 bg-emerald-50/60",
  amber: "border-amber-200 bg-amber-50/60",
  rose: "border-rose-200 bg-rose-50/60",
};

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border p-4 ${TONE_CLASS[tone] ?? TONE_CLASS.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
    </div>
  );
}
