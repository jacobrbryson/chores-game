"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { AppMenu } from "@/components/app-menu";
import { MenuActionButton } from "@/components/menu-action-button";
import { SupportCommunityAwardsPanel } from "@/components/support-community-awards-panel";
import { SupportFamilyActivityChart } from "@/components/support-family-activity-chart";
import { SupportContentPanel, SupportSeoPanel } from "@/components/support-content-panel";
import { SupportConsoleShell, type SupportModuleId } from "@/components/support-console-shell";
import { SupportFeedPanel } from "@/components/support-feed-panel";
import { SupportChoreUsagePanel } from "@/components/support-chore-usage-panel";
import { SupportMetricsStrip, type SupportMetric } from "@/components/support-metrics-strip";
import { SupportNewslettersPanel } from "@/components/support-newsletters-panel";
import { SupportStaleInvitesPanel } from "@/components/support-stale-invites-panel";
import { SupportInviteCodesPanel } from "@/components/support-invite-codes-panel";
import { SupportDuplicateChildrenPanel } from "@/components/support-duplicate-children-panel";
import { SupportResponsibilityPanel } from "@/components/support-responsibility-panel";
import { SupportOperationsPanel } from "@/components/support-operations-panel";
import { SupportAnalyticsPanel } from "@/components/support-analytics-panel";
import { SupportFamilyHealthPanel } from "@/components/support-family-health-panel";
import type { SupportDashboardMetrics } from "@/lib/support/dashboard-metrics";

type SupportUser = {
  uid: string;
  email: string;
  name: string;
  role: string;
  familyIds: string[];
  walletBalance: number;
  googleTasksLinked: boolean;
  googleTasksLastSyncStatus: string;
  lastSignInAt: string;
};

type SupportFamily = {
  id: string;
  name: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  admins: Array<{ name: string }>;
  lastWeeklyHighlightSentAt: string;
  lastActivityAt: string;
};

type WeeklyHighlightsPreview = {
  family: {
    familyName: string;
    recipients: Array<{ uid: string; email: string; optedIn: boolean }>;
  };
  metrics: {
    choresCompleted: number;
    coinsEarned: number;
    rewardsRedeemed: number;
    pendingApprovals: number;
    hasActivity: boolean;
  };
  rendered: {
    subject: string;
    html: string;
    text: string;
  };
};

type SupportChore = {
  id: string;
  familyId: string;
  title: string;
  status: string;
  assigneeId: string;
  assigneeIds: string[];
  assigneeName: string;
  requireApproval: boolean;
  coinValue: number;
  source: string;
  googleTaskOwnerUid: string;
  submittedAt: string;
  updatedAt: string;
  createdAt: string;
};

type SupportLedger = {
  id: string;
  uid: string;
  reason: string;
  delta: number;
  balanceAfter: number;
  choreId: string;
  itemId: string;
  createdAt: string;
};

type SupportEvent = {
  id: string;
  familyId: string;
  kind: "audit" | "notification";
  eventType: string;
  title: string;
  message: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  userId: string;
  choreId: string;
  choreTitle: string;
  source: string;
  reason: string;
  createdAt: string;
  raw: Record<string, unknown>;
};

type SupportPayload = {
  users: SupportUser[];
  families: SupportFamily[];
  chores: SupportChore[];
  ledgers: SupportLedger[];
  events: SupportEvent[];
  supportDashboardMetrics: SupportDashboardMetrics;
  suspicious: Array<{
    choreId: string;
    familyId: string;
    title: string;
    assigneeId: string;
    submittedAt: string;
    updatedAt: string;
    reason: string;
  }>;
  counts: {
    users: number;
    families: number;
    chores: number;
    auditEvents: number;
    notifications: number;
    maxResultRows?: number;
  };
};

type SupportRequestsSummary = {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
};
type WsMetrics = {
  activeUsers: number;
  connectedClients: number;
  unavailable?: boolean;
};

const PAGE_SIZE = 20;
const FAMILIES_PAGE_SIZE = 5;

const MODULE_COPY: Record<SupportModuleId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Support Dashboard",
    subtitle: "Cross-family operational health, recent activity, and support diagnostics.",
  },
  families: {
    title: "Families",
    subtitle: "Inspect family records, admins, newsletter sends, and family-scoped activity.",
  },
  chores: {
    title: "Chores",
    subtitle: "Browse chore records across families and remove problematic entries.",
  },
  users: {
    title: "Users",
    subtitle: "Review accounts, roles, wallet state, and linked Google Tasks status.",
  },
  communication: {
    title: "Communication",
    subtitle: "Monitor newsletters and family activity feed delivery signals.",
  },
  requests: {
    title: "Requests",
    subtitle: "Manage bug reports and feature requests.",
  },
  awards: {
    title: "Awards",
    subtitle: "Review and moderate community-submitted award ideas.",
  },
  content: {
    title: "Content",
    subtitle: "Create, review, publish, and archive curated public SEO content.",
  },
  seo: {
    title: "SEO",
    subtitle: "Monitor public content health, metadata readiness, and sitemap eligibility.",
  },
  responsibility: {
    title: "Responsibility",
    subtitle:
      "Manage Responsibility Pillars: XP configuration, suggested chores, the community routine library, and analytics.",
  },
  operations: {
    title: "Operations",
    subtitle:
      "Detect app slowness, database pagination risks, slow queries, API errors, and background job failures before they reach users.",
  },
  analytics: {
    title: "Analytics",
    subtitle:
      "Family health scoring (thriving / at risk / inactive) plus the centralized analytics event pipeline validation view.",
  },
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function compactId(value: string) {
  if (!value) return "-";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function containsQuery(values: string[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function statusClass(status: string) {
  if (status === "Approved") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "Submitted") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  if (status === "Rejected" || status === "Deleted") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
}

function recentCount(values: string[], days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return values.filter((value) => {
    const millis = Date.parse(value);
    return Number.isFinite(millis) && millis >= cutoff;
  }).length;
}

function paginate<T>(rows: T[], page: number, pageSize: number = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  return {
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    page: safePage,
    totalPages,
  };
}

function SearchBar({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm font-semibold text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
        placeholder={placeholder}
      />
    </label>
  );
}

function Pager({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        Page {page} of {totalPages} ({total} result{total === 1 ? "" : "s"})
      </span>
      <div className="flex gap-2">
        <Button className="btn btn-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="family-skeleton family-skeleton-row" />
        <div className="family-skeleton family-skeleton-row" />
        <div className="family-skeleton family-skeleton-row" />
        <div className="family-skeleton family-skeleton-row" />
      </div>
      <div className="mt-4 space-y-3">
        <div className="family-skeleton family-skeleton-row" />
        <div className="family-skeleton family-skeleton-row" />
        <div className="family-skeleton family-skeleton-row" />
      </div>
    </section>
  );
}

function EventsTable({ events, title = "Activity Objects" }: { events: SupportEvent[]; title?: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Object</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.kind}-${event.id}`} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{event.eventType || event.title || event.kind}</div>
                  <div className="text-xs text-slate-500">{event.kind}</div>
                </td>
                <td className="px-3 py-2">
                  <div>{event.message || event.reason || event.choreTitle || "-"}</div>
                  <div className="text-xs text-slate-500">{compactId(event.choreId || event.userId || event.id)}</div>
                </td>
                <td className="px-3 py-2">{event.actorEmail || event.actorName || compactId(event.actorUid)}</td>
                <td className="px-3 py-2">{compactId(event.familyId)}</td>
                <td className="px-3 py-2">{formatDate(event.createdAt)}</td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  No objects in the loaded support dataset.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SupportPageClient({ module }: { module: SupportModuleId }) {
  const [payload, setPayload] = useState<SupportPayload | null>(null);
  const [requestsSummary, setRequestsSummary] = useState<SupportRequestsSummary | null>(null);
  const [wsMetrics, setWsMetrics] = useState<WsMetrics | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [duplicateChildrenCount, setDuplicateChildrenCount] = useState<number | null>(null);
  const [staleInvitesCount, setStaleInvitesCount] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    entity: "family" | "user" | "chore";
    id: string;
    label: string;
    familyId?: string;
  } | null>(null);
  const [pendingConsentReset, setPendingConsentReset] = useState<{
    familyId: string;
    label: string;
  } | null>(null);
  const [consentResetting, setConsentResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingHighlights, setPendingHighlights] = useState<SupportFamily | null>(null);
  const [highlightsPreview, setHighlightsPreview] = useState<WeeklyHighlightsPreview | null>(null);
  const [highlightsPreviewLoading, setHighlightsPreviewLoading] = useState(false);
  const [highlightsError, setHighlightsError] = useState("");
  const [highlightsSending, setHighlightsSending] = useState(false);

  const loadSupportData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/debug", { cache: "no-store" });
      const data = (await response.json()) as SupportPayload & { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Support data unavailable");
      }
      setPayload(data);
      const [summaryResponse, wsMetricsResponse] = await Promise.all([
        fetch("/api/support/requests/summary", { cache: "no-store" }),
        fetch("/api/support/ws-metrics", { cache: "no-store" }),
      ]);
      const summaryData = (await summaryResponse.json().catch(() => ({}))) as {
        summary?: SupportRequestsSummary;
      };
      const wsMetricsData = (await wsMetricsResponse.json().catch(() => ({}))) as WsMetrics;
      setRequestsSummary(summaryResponse.ok ? summaryData.summary ?? null : null);
      setWsMetrics(wsMetricsResponse.ok ? wsMetricsData : { activeUsers: 0, connectedClients: 0, unavailable: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Support data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  useEffect(() => {
    setPage(1);
    setQuery("");
  }, [module]);

  const dashboardMetrics = useMemo<SupportMetric[]>(() => {
    if (!payload) return [];
    return [
      {
        label: "Active Users",
        value: wsMetrics?.activeUsers ?? "0",
        detail: wsMetrics?.unavailable ? "Websocket metrics unavailable" : `${wsMetrics?.connectedClients ?? 0} connected client${wsMetrics?.connectedClients === 1 ? "" : "s"}`,
        tone: "emerald",
      },
      {
        label: "New Requests",
        value: requestsSummary?.byStatus?.new ?? 0,
        detail: "Needs support review",
        tone: "amber",
      },
      { label: "Families", value: payload.counts.families, detail: "Total family records", tone: "sky" },
      { label: "Users", value: payload.counts.users, detail: "Total user records", tone: "violet" },
    ];
  }, [payload, requestsSummary, wsMetrics]);

  const familyMetrics = useMemo<SupportMetric[]>(() => {
    const families = payload?.families ?? [];
    const metrics: SupportMetric[] = [
      { label: "Families", value: payload?.counts.families ?? 0, detail: "Total family records", tone: "sky" },
      {
        label: "Activity",
        value: recentCount(families.map((family) => family.lastActivityAt), 30),
        detail: "Families active last 30 days",
        tone: "violet",
      },
      { label: "New Families", value: recentCount(families.map((family) => family.createdAt), 30), detail: "Created last 30 days", tone: "emerald" },
      {
        label: "Highlights Sent",
        value: recentCount(families.map((family) => family.lastWeeklyHighlightSentAt), 30),
        detail: "Weekly email sends last 30 days",
        tone: "amber",
      },
    ];
    if (duplicateChildrenCount) {
      metrics.push({
        label: "Duplicate Children",
        value: duplicateChildrenCount,
        detail: "Possible duplicate child profiles",
        tone: "rose",
      });
    }
    if (staleInvitesCount) {
      metrics.push({
        label: "Stale Invites",
        value: staleInvitesCount,
        detail: "Orphaned invite records",
        tone: "amber",
      });
    }
    return metrics;
  }, [payload, duplicateChildrenCount, staleInvitesCount]);

  const userMetrics = useMemo<SupportMetric[]>(() => {
    const users = payload?.users ?? [];
    return [
      { label: "Users", value: payload?.counts.users ?? 0, detail: "Total user records", tone: "violet" },
      { label: "Admins", value: users.filter((user) => user.role === "admin").length, detail: "Parent/admin accounts", tone: "sky" },
      { label: "Tasks Linked", value: users.filter((user) => user.googleTasksLinked).length, detail: "Google Tasks profiles", tone: "emerald" },
      { label: "Wallet Coins", value: users.reduce((sum, user) => sum + user.walletBalance, 0), detail: "Loaded user balances", tone: "amber" },
    ];
  }, [payload]);

  const eventMetrics = useMemo<SupportMetric[]>(() => {
    const events = payload?.events ?? [];
    return [
      { label: "Events", value: events.length, detail: "Loaded activity rows", tone: "violet" },
      { label: "Notifications", value: events.filter((event) => event.kind === "notification").length, detail: "Family-visible activity", tone: "sky" },
      { label: "Audit Events", value: events.filter((event) => event.kind === "audit").length, detail: "Internal records", tone: "amber" },
      { label: "Last 7 Days", value: recentCount(events.map((event) => event.createdAt), 7), detail: "Recent activity", tone: "emerald" },
    ];
  }, [payload]);

  const filteredFamilies = useMemo(
    () =>
      (payload?.families ?? [])
        .filter((family) =>
          containsQuery([family.id, family.name, family.createdBy, family.createdByEmail], query),
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [payload, query],
  );
  const filteredUsers = useMemo(
    () =>
      (payload?.users ?? []).filter((user) =>
        containsQuery([user.uid, user.email, user.name, user.role, user.familyIds.join(" ")], query),
      ),
    [payload, query],
  );
  const filteredChores = useMemo(
    () =>
      (payload?.chores ?? []).filter((chore) =>
        containsQuery([chore.id, chore.familyId, chore.title, chore.status, chore.assigneeName, chore.source], query),
      ),
    [payload, query],
  );
  const filteredEvents = useMemo(
    () =>
      (payload?.events ?? []).filter((event) =>
        containsQuery(
          [event.id, event.familyId, event.eventType, event.title, event.message, event.actorEmail, event.choreTitle],
          query,
        ),
      ),
    [payload, query],
  );

  async function deleteEntity(entity: "family" | "user" | "chore", id: string, familyId?: string) {
    if (deleting) return;
    setDeleting(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id, familyId }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Delete failed");
      }
      setNotice(`${entity} deleted.`);
      await loadSupportData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  function requestDelete(entity: "family" | "user" | "chore", id: string, label: string, familyId?: string) {
    setPendingDelete({ entity, id, label, familyId });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { entity, id, familyId } = pendingDelete;
    setPendingDelete(null);
    await deleteEntity(entity, id, familyId);
  }

  function closeHighlights() {
    if (highlightsSending) return;
    setPendingHighlights(null);
    setHighlightsPreview(null);
    setHighlightsError("");
  }

  async function requestSendHighlights(family: SupportFamily) {
    setPendingHighlights(family);
    setHighlightsPreview(null);
    setHighlightsError("");
    setHighlightsPreviewLoading(true);
    try {
      const response = await fetch(
        `/api/support/newsletters/weekly/preview?familyId=${encodeURIComponent(family.id)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as WeeklyHighlightsPreview & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `SUPPORT_NEWSLETTER_PREVIEW_HTTP_${response.status}`);
      }
      setHighlightsPreview(data);
    } catch (previewError) {
      setHighlightsError(
        previewError instanceof Error ? previewError.message : "weekly_newsletter_preview_unavailable",
      );
    } finally {
      setHighlightsPreviewLoading(false);
    }
  }

  async function confirmSendHighlights() {
    if (!pendingHighlights || highlightsSending) return;
    const family = pendingHighlights;
    setHighlightsSending(true);
    setHighlightsError("");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/newsletters/weekly/send-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: family.id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        skipped?: number;
        failed?: number;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "weekly_newsletter_send_failed");
      }
      setNotice(
        `Weekly highlights for ${family.name}: ${data.sent ?? 0} sent, ${data.skipped ?? 0} skipped, ${data.failed ?? 0} failed.`,
      );
      setPendingHighlights(null);
      setHighlightsPreview(null);
      await loadSupportData();
    } catch (sendError) {
      setHighlightsError(
        sendError instanceof Error ? sendError.message : "weekly_newsletter_send_failed",
      );
    } finally {
      setHighlightsSending(false);
    }
  }

  async function resetConsent(familyId: string, mode: "reacceptance" | "full") {
    setConsentResetting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/privacy/reset-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, mode }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Reset failed");
      }
      setNotice(
        mode === "full"
          ? "Consent fully reset — family will see the onboarding wizard on next sign-in."
          : "Version strings cleared — family will see the re-acceptance modal on next dashboard load.",
      );
      setPendingConsentReset(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset consent failed");
    } finally {
      setConsentResetting(false);
    }
  }

  const copy = MODULE_COPY[module];
  const actions =
    module === "dashboard" ? (
      <>
        <Button className="btn btn-secondary" disabled={loading} onClick={() => void loadSupportData()}>
          Refresh
        </Button>
        <Link href="/support/requests" className="btn btn-primary">
          Manage Requests
        </Link>
      </>
    ) : (
      <Button className="btn btn-secondary" disabled={loading} onClick={() => void loadSupportData()}>
        Refresh
      </Button>
    );

  return (
    <SupportConsoleShell activeModule={module} title={copy.title} subtitle={copy.subtitle} actions={actions}>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {loading && module !== "operations" && module !== "analytics" ? <LoadingSkeleton /> : null}

      {module === "operations" ? <SupportOperationsPanel /> : null}

      {module === "analytics" ? (
        <>
          <SupportFamilyHealthPanel />
          <SupportAnalyticsPanel />
        </>
      ) : null}

      {!loading && payload && module === "dashboard" ? (
        <>
          <SupportMetricsStrip metrics={dashboardMetrics} forceSingleRow />
          {payload.suspicious.length ? (
            <Alert tone="warning">
              {payload.suspicious.length} submitted chore(s) have approval or payout evidence.
            </Alert>
          ) : null}
          <SupportFamilyActivityChart
            series={payload.supportDashboardMetrics.familyActivity30DaySeries}
            updatedAt={payload.supportDashboardMetrics.updatedAt}
          />
        </>
      ) : null}

      {!loading && payload && module === "families" ? (
        <>
          <SupportMetricsStrip metrics={familyMetrics} forceSingleRow />
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
              <SearchBar label="Search families" value={query} onChange={setQuery} placeholder="Family name, ID, creator" />
            </div>
            <FamiliesTable
              families={paginate(filteredFamilies, page, FAMILIES_PAGE_SIZE).rows}
              deleting={deleting}
              onDelete={(family) => requestDelete("family", family.id, family.name)}
              onSendHighlights={(family) => void requestSendHighlights(family)}
            />
            <Pager
              page={paginate(filteredFamilies, page, FAMILIES_PAGE_SIZE).page}
              totalPages={paginate(filteredFamilies, page, FAMILIES_PAGE_SIZE).totalPages}
              total={filteredFamilies.length}
              onPageChange={setPage}
            />
          </section>
          <SupportDuplicateChildrenPanel onCountChange={setDuplicateChildrenCount} />
          <SupportStaleInvitesPanel onCountChange={setStaleInvitesCount} />
          <SupportInviteCodesPanel />
        </>
      ) : null}

      {!loading && payload && module === "users" ? (
        <>
          <SupportMetricsStrip metrics={userMetrics} forceSingleRow />
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
              <SearchBar label="Search users" value={query} onChange={setQuery} placeholder="Email, name, UID, role" />
            </div>
            <UsersTable
              users={paginate(filteredUsers, page).rows}
              deleting={deleting}
              consentResetting={consentResetting}
              onDelete={(user) => requestDelete("user", user.uid, user.name || user.email || user.uid)}
              onResetConsent={(user) =>
                setPendingConsentReset({
                  familyId: user.familyIds[0] ?? "",
                  label: user.name || user.email || user.uid,
                })
              }
            />
            <Pager
              page={paginate(filteredUsers, page).page}
              totalPages={paginate(filteredUsers, page).totalPages}
              total={filteredUsers.length}
              onPageChange={setPage}
            />
          </section>
        </>
      ) : null}

      {!loading && payload && module === "communication" ? (
        <>
          <SupportMetricsStrip metrics={eventMetrics} forceSingleRow />
          <SupportNewslettersPanel />
          <SupportFeedPanel events={payload.events} />
          <EventsTable events={filteredEvents} title="Communication Objects" />
        </>
      ) : null}

      {!loading && payload && module === "awards" ? (
        <>
          <SupportMetricsStrip metrics={eventMetrics} forceSingleRow />
          <SupportCommunityAwardsPanel />
        </>
      ) : null}

      {!loading && payload && module === "chores" ? (
        <>
          <SupportChoreUsagePanel />
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50/70 p-4">
              <h3 className="text-lg font-bold text-slate-900">Browse &amp; Remove Chores</h3>
              <p className="mt-1 text-sm text-slate-500">
                Look up an individual chore record to inspect or delete it.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <SearchBar label="Search chores" value={query} onChange={setQuery} placeholder="Title, status, assignee, source" />
              </div>
            </div>
            <ChoresTable
              chores={paginate(filteredChores, page).rows}
              deleting={deleting}
              onDelete={(chore) => requestDelete("chore", chore.id, chore.title, chore.familyId)}
            />
            <Pager
              page={paginate(filteredChores, page).page}
              totalPages={paginate(filteredChores, page).totalPages}
              total={filteredChores.length}
              onPageChange={setPage}
            />
          </section>
        </>
      ) : null}

      {!loading && payload && module === "content" ? <SupportContentPanel /> : null}

      {!loading && payload && module === "seo" ? <SupportSeoPanel /> : null}

      {!loading && payload && module === "responsibility" ? <SupportResponsibilityPanel /> : null}
      <ModalShell open={Boolean(pendingConsentReset)} onRequestClose={() => setPendingConsentReset(null)}>
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingConsentReset ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">Reset consent</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingConsentReset(null)}
                  aria-label="Close">
                  X
                </Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                Resetting consent for{" "}
                <strong className="text-slate-900">{pendingConsentReset.label}</strong>.
                Choose how far back to reset.
              </p>
              <div className="mb-5 flex flex-col gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm hover:bg-amber-100 disabled:opacity-50"
                  disabled={consentResetting}
                  onClick={() => void resetConsent(pendingConsentReset.familyId, "reacceptance")}>
                  <div className="font-semibold text-amber-900">Re-acceptance only</div>
                  <div className="mt-0.5 text-amber-700">
                    Clears accepted policy versions. The family keeps their onboarding state
                    but will see the blocking re-acceptance modal on their next dashboard visit.
                  </div>
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm hover:bg-rose-100 disabled:opacity-50"
                  disabled={consentResetting}
                  onClick={() => void resetConsent(pendingConsentReset.familyId, "full")}>
                  <div className="font-semibold text-rose-900">Full reset</div>
                  <div className="mt-0.5 text-rose-700">
                    Clears all consent fields including parental consent date and onboarding
                    completion. The family will go through the full onboarding wizard on next sign-in.
                  </div>
                </button>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingConsentReset(null)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell open={Boolean(pendingDelete)} onRequestClose={() => setPendingDelete(null)}>
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingDelete ? (
            <>
              <div className="modal-dialog-title-row mb-3">
                <h3 className="text-lg font-bold text-slate-800">
                  Delete {pendingDelete.entity}?
                </h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingDelete(null)}
                  aria-label="Close">
                  X
                </Button>
              </div>
              <p className="mb-5 text-sm text-slate-600">
                This will permanently delete{" "}
                <strong className="text-slate-900">{pendingDelete.label}</strong>.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>
                  Cancel
                </Button>
                <Button type="button" className="btn btn-danger" onClick={() => void confirmDelete()}>
                  Delete
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>

      <ModalShell open={Boolean(pendingHighlights)} onRequestClose={closeHighlights}>
        <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingHighlights ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">Send weekly highlights?</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  disabled={highlightsSending}
                  onClick={closeHighlights}
                  aria-label="Close">
                  X
                </Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                This sends the live weekly highlights email to every opted-in recipient of{" "}
                <strong className="text-slate-900">{pendingHighlights.name}</strong>. Review the preview below
                before sending.
              </p>
              {highlightsError ? <Alert className="mb-3">{highlightsError}</Alert> : null}
              {highlightsPreviewLoading ? (
                <p className="text-sm text-slate-500">Loading preview...</p>
              ) : null}
              {highlightsPreview ? (
                <div className="space-y-4">
                  {!highlightsPreview.metrics.hasActivity ? (
                    <Alert tone="warning">
                      This family had no activity this week. The automatic weekly cron would skip
                      them (no_activity) — sending now overrides that and emails them manually.
                    </Alert>
                  ) : null}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div><strong>Subject:</strong> {highlightsPreview.rendered.subject}</div>
                    <div>
                      <strong>Recipients:</strong>{" "}
                      {highlightsPreview.family.recipients.filter((recipient) => recipient.optedIn).length} opted-in
                      {" "}of {highlightsPreview.family.recipients.length}
                    </div>
                    <div>
                      <strong>Activity this week:</strong>{" "}
                      {highlightsPreview.metrics.hasActivity ? "Yes" : "No activity"}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
                    <div>Chores completed: <strong>{highlightsPreview.metrics.choresCompleted}</strong></div>
                    <div>Coins earned: <strong>{highlightsPreview.metrics.coinsEarned}</strong></div>
                    <div>Rewards redeemed: <strong>{highlightsPreview.metrics.rewardsRedeemed}</strong></div>
                    <div>Pending approvals: <strong>{highlightsPreview.metrics.pendingApprovals}</strong></div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                      Rendered HTML preview
                    </div>
                    <div
                      className="max-h-[24rem] overflow-auto p-3"
                      dangerouslySetInnerHTML={{ __html: highlightsPreview.rendered.html }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={highlightsSending}
                  onClick={closeHighlights}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={highlightsSending || highlightsPreviewLoading || !highlightsPreview}
                  onClick={() => void confirmSendHighlights()}>
                  {highlightsSending ? "Sending..." : "Send to family"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </SupportConsoleShell>
  );
}

function FamiliesTable({
  families,
  deleting,
  onDelete,
  onSendHighlights,
}: {
  families: SupportFamily[];
  deleting: string | null;
  onDelete: (family: SupportFamily) => void;
  onSendHighlights: (family: SupportFamily) => void;
}) {
  const router = useRouter();

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Family</th>
            <th className="px-3 py-2">Admins</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Weekly Highlights</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {families.map((family) => (
            <tr
              key={family.id}
              className="cursor-pointer border-t border-slate-100 align-top transition-colors hover:bg-sky-50/50 focus-within:bg-sky-50/50"
              tabIndex={0}
              role="link"
              aria-label={`Open ${family.name}`}
              onClick={() => router.push(`/support/families/${encodeURIComponent(family.id)}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(`/support/families/${encodeURIComponent(family.id)}`);
                }
              }}>
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{family.name}</div>
                <div className="text-xs text-slate-500">{family.createdByEmail || compactId(family.createdBy)}</div>
              </td>
              <td className="px-3 py-2">
                {family.admins.length ? family.admins.map((admin) => admin.name).join(", ") : "-"}
              </td>
              <td className="px-3 py-2">{formatDate(family.createdAt)}</td>
              <td className="px-3 py-2">{family.lastWeeklyHighlightSentAt ? formatDate(family.lastWeeklyHighlightSentAt) : "Never"}</td>
              <td
                className="px-3 py-2"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}>
                <FamilyActionsMenu
                  family={family}
                  deleting={deleting}
                  onDelete={onDelete}
                  onSendHighlights={onSendHighlights}
                />
              </td>
            </tr>
          ))}
          {families.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                No families match the current search.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FamilyActionsMenu({
  family,
  deleting,
  onDelete,
  onSendHighlights,
}: {
  family: SupportFamily;
  deleting: string | null;
  onDelete: (family: SupportFamily) => void;
  onSendHighlights: (family: SupportFamily) => void;
}) {
  const [open, setOpen] = useState(false);
  const busy = deleting === family.id;

  return (
    <AppMenu
      open={open}
      onOpenChange={setOpen}
      triggerClassName="btn btn-secondary"
      triggerAriaLabel="Family actions"
      triggerDisabled={busy}
      panelClassName="app-menu-panel"
      trigger={busy ? "..." : "Actions ▾"}>
      <MenuActionButton
        fullWidth
        onClick={() => {
          setOpen(false);
          onSendHighlights(family);
        }}>
        Send weekly highlights…
      </MenuActionButton>
      <MenuActionButton
        fullWidth
        className="menu-action-link-danger"
        onClick={() => {
          setOpen(false);
          onDelete(family);
        }}>
        Delete…
      </MenuActionButton>
    </AppMenu>
  );
}

function UserActionsMenu({
  user,
  deleting,
  consentResetting,
  onDelete,
  onResetConsent,
}: {
  user: SupportUser;
  deleting: string | null;
  consentResetting: boolean;
  onDelete: (user: SupportUser) => void;
  onResetConsent: (user: SupportUser) => void;
}) {
  const [open, setOpen] = useState(false);
  const busy = deleting === user.uid || consentResetting;

  return (
    <AppMenu
      open={open}
      onOpenChange={setOpen}
      triggerClassName="btn btn-secondary"
      triggerAriaLabel="User actions"
      triggerDisabled={busy}
      panelClassName="app-menu-panel"
      trigger={busy ? "..." : "Actions ▾"}>
      <MenuActionButton
        fullWidth
        disabled={!user.familyIds[0]}
        onClick={() => {
          setOpen(false);
          onResetConsent(user);
        }}>
        Reset Consent…
      </MenuActionButton>
      <MenuActionButton
        fullWidth
        className="menu-action-link-danger"
        onClick={() => {
          setOpen(false);
          onDelete(user);
        }}>
        Delete…
      </MenuActionButton>
    </AppMenu>
  );
}

function UsersTable({
  users,
  deleting,
  consentResetting,
  onDelete,
  onResetConsent,
}: {
  users: SupportUser[];
  deleting: string | null;
  consentResetting: boolean;
  onDelete: (user: SupportUser) => void;
  onResetConsent: (user: SupportUser) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Families</th>
            <th className="px-3 py-2">Coins</th>
            <th className="px-3 py-2">Tasks</th>
            <th className="px-3 py-2">Last Sign In</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.uid} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{user.name || user.email || user.uid}</div>
                <div className="text-xs text-slate-500">{user.email || user.uid}</div>
              </td>
              <td className="px-3 py-2">{user.role}</td>
              <td className="px-3 py-2">{user.familyIds.length}</td>
              <td className="px-3 py-2">{user.walletBalance}</td>
              <td className="px-3 py-2">{user.googleTasksLinked ? user.googleTasksLastSyncStatus || "Linked" : "-"}</td>
              <td className="px-3 py-2">{formatDate(user.lastSignInAt)}</td>
              <td className="px-3 py-2">
                <UserActionsMenu
                  user={user}
                  deleting={deleting}
                  consentResetting={consentResetting}
                  onDelete={onDelete}
                  onResetConsent={onResetConsent}
                />
              </td>
            </tr>
          ))}
          {users.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                No users match the current search.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ChoresTable({
  chores,
  deleting,
  onDelete,
}: {
  chores: SupportChore[];
  deleting: string | null;
  onDelete: (chore: SupportChore) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Object</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Assignee</th>
            <th className="px-3 py-2">Coins</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Updated</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {chores.map((chore) => (
            <tr key={`${chore.familyId}-${chore.id}`} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{chore.title}</div>
                <div className="text-xs text-slate-500">
                  {compactId(chore.id)} / {compactId(chore.familyId)}
                </div>
              </td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(chore.status)}`}>
                  {chore.status}
                </span>
              </td>
              <td className="px-3 py-2">{chore.assigneeName || compactId(chore.assigneeId)}</td>
              <td className="px-3 py-2">{chore.coinValue}</td>
              <td className="px-3 py-2">{chore.source}</td>
              <td className="px-3 py-2">{formatDate(chore.updatedAt || chore.createdAt)}</td>
              <td className="px-3 py-2">
                <Button className="btn btn-danger" disabled={deleting === chore.id} onClick={() => onDelete(chore)}>
                  {deleting === chore.id ? "Deleting..." : "Delete"}
                </Button>
              </td>
            </tr>
          ))}
          {chores.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                No objects match the current search.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
