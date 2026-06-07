"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { EnumChip } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";
import { CategorySelector } from "@/components/category-selector";
import { SupportConsoleShell } from "@/components/support-console-shell";
import {
  BUG_CATEGORY_KEYS,
  FEATURE_CATEGORY_KEYS,
  type PublicSupportRequestStatus,
  type SupportRequestSeverity,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/requests";

type ListRecord = {
  id: string;
  familyId: string;
  familyName: string;
  type: SupportRequestType;
  subject: string;
  descriptionPreview: string;
  status: SupportRequestStatus;
  severity: SupportRequestSeverity | null;
  category: string;
  createdByUid: string;
  createdByDisplayName: string;
  createdByEmail: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
  publicPublishedAt: string;
  publicPublishedByUid: string;
  publicUpdatedAt: string;
};

type Summary = {
  total: number;
  byStatus: Record<SupportRequestStatus, number>;
  byType: Record<SupportRequestType, number>;
  bugsBySeverity: Record<"low" | "medium" | "high", number>;
  highSeverityBugs: number;
  recentCreatedLast7Days: number;
  closedLast7Days: number;
  averageHoursToClose: number | null;
};

type ListResponse = {
  requests: ListRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type DetailResponse = {
  request: ListRecord & { description: string; userAgent: string };
  history: Array<{
    id: string;
    previousStatus: string;
    nextStatus: string;
    note: string;
    changedByUid: string;
    changedByEmail: string;
    createdAt: string;
  }>;
  activity: Array<{
    id: string;
    eventType: string;
    source: string;
    reason: string;
    actorUid: string;
    actorEmail: string;
    actorName: string;
    createdAt: string;
    previousStatus: string;
    nextStatus: string;
  }>;
  statuses: SupportRequestStatus[];
};

type Filters = {
  q: string;
  type: string;
  status: string;
  severity: string;
  category: string;
  familyId: string;
  reporter: string;
  createdFrom: string;
  createdTo: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  page: number;
};

const PAGE_SIZE = 20;
const PUBLIC_STATUSES: PublicSupportRequestStatus[] = [
  "under_review",
  "planned",
  "in_progress",
  "completed",
  "declined",
];

function statusTone(status: SupportRequestStatus) {
  if (status === "done") return "green";
  if (status === "declined" || status === "duplicate") return "rose";
  if (status === "in_progress") return "amber";
  if (status === "planned") return "violet";
  if (status === "triaged") return "indigo";
  return "blue";
}

function severityTone(severity: SupportRequestSeverity) {
  return severity === "high" ? "rose" : severity === "medium" ? "amber" : "teal";
}

function formatDateTime(value: string, locale: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(locale) : "-";
}

function SupportRequestsSkeleton() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="family-skeleton-chip-row">
        <div className="family-skeleton family-skeleton-chip" />
        <div className="family-skeleton family-skeleton-chip" />
        <div className="family-skeleton family-skeleton-chip" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
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

export default function SupportRequestsPageClient() {
  const { locale, t } = useLocale();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [list, setList] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [selected, setSelected] = useState<ListRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuildingSnapshot, setIsRebuildingSnapshot] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusDraft, setStatusDraft] = useState<SupportRequestStatus>("new");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [publicDraft, setPublicDraft] = useState({
    isPublic: false,
    publicTitle: "",
    publicDescription: "",
    publicStatus: "under_review" as PublicSupportRequestStatus,
  });
  const [filters, setFilters] = useState<Filters>({
    q: "",
    type: "all",
    status: "all",
    severity: "all",
    category: "all",
    familyId: "",
    reporter: "",
    createdFrom: "",
    createdTo: "",
    sortBy: "updatedAt",
    sortDir: "desc",
    page: 1,
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(filters.page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sortBy", filters.sortBy);
    params.set("sortDir", filters.sortDir);
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.type !== "all") params.set("type", filters.type);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.severity !== "all") params.set("severity", filters.severity);
    if (filters.category !== "all") params.set("category", filters.category);
    if (filters.familyId.trim()) params.set("familyId", filters.familyId.trim());
    if (filters.reporter.trim()) params.set("reporter", filters.reporter.trim());
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [summaryResponse, listResponse] = await Promise.all([
        fetch("/api/support/requests/summary", { cache: "no-store" }),
        fetch(`/api/support/requests?${queryString}`, { cache: "no-store" }),
      ]);
      const summaryJson = (await summaryResponse.json().catch(() => ({}))) as {
        summary?: Summary;
        error?: string;
      };
      const listJson = (await listResponse.json().catch(() => ({}))) as ListResponse & {
        error?: string;
      };
      if (!summaryResponse.ok) {
        throw new Error(summaryJson.error ?? "support_requests_unavailable");
      }
      if (!listResponse.ok) {
        throw new Error(listJson.error ?? "support_requests_unavailable");
      }
      setSummary(summaryJson.summary ?? null);
      setList(listJson);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "support_requests_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(request: ListRecord) {
    setSelected(request);
    setDetail(null);
    setDetailError("");
    setDeleteConfirming(false);
    setIsDetailLoading(true);
    try {
      const response = await fetch(
        `/api/support/requests/${encodeURIComponent(request.id)}?familyId=${encodeURIComponent(request.familyId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as DetailResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "support_request_unavailable");
      }
      setDetail(data);
      setStatusDraft(data.request.status);
      setCategoryDraft(data.request.category ?? "");
      setPublicDraft({
        isPublic: data.request.isPublic,
        publicTitle: data.request.publicTitle || data.request.subject,
        publicDescription: data.request.publicDescription || data.request.description,
        publicStatus: data.request.publicStatus,
      });
      setNoteDraft("");
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "support_request_unavailable");
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function saveStatus() {
    if (!selected || !detail || isSaving) {
      return;
    }
    setIsSaving(true);
    setDetailError("");
    setNotice("");
    try {
      const response = await fetch(`/api/support/requests/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId: selected.familyId,
          status: statusDraft,
          note: noteDraft.trim(),
          category: categoryDraft.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { request?: DetailResponse["request"]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "update_support_request_failed");
      }
      setNotice(t("supportManagement.notice.statusUpdated"));
      setSelected((current) =>
        current ? { ...current, status: statusDraft, updatedAt: data.request?.updatedAt ?? current.updatedAt } : current,
      );
      setList((current) =>
        current
          ? {
              ...current,
              requests: current.requests.map((entry) =>
                entry.id === selected.id && entry.familyId === selected.familyId
                  ? { ...entry, status: statusDraft, updatedAt: data.request?.updatedAt ?? entry.updatedAt }
                  : entry,
              ),
            }
          : current,
      );
      await openDetail({ ...selected, status: statusDraft, updatedAt: data.request?.updatedAt ?? selected.updatedAt });
      await load();
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : "update_support_request_failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRequest() {
    if (!selected || deletePending) {
      return;
    }
    setDeletePending(true);
    setDetailError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "supportRequest",
          id: selected.id,
          familyId: selected.familyId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "delete_failed");
      }
      setSelected(null);
      setDeleteConfirming(false);
      setNotice(t("supportManagement.notice.deleted"));
      await load();
    } catch (deleteErr) {
      setDetailError(deleteErr instanceof Error ? deleteErr.message : "delete_failed");
    } finally {
      setDeletePending(false);
    }
  }

  async function rebuildSnapshot() {
    if (isRebuildingSnapshot) {
      return;
    }
    setIsRebuildingSnapshot(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/requests/snapshot", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "snapshot_rebuild_failed");
      }
      setNotice(t("supportManagement.notice.snapshotRebuilt"));
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : "snapshot_rebuild_failed");
    } finally {
      setIsRebuildingSnapshot(false);
    }
  }

  async function savePublicVisibility() {
    if (!selected || !detail || isSaving) {
      return;
    }
    setIsSaving(true);
    setDetailError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/support/requests/${encodeURIComponent(selected.id)}/public`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyId: selected.familyId,
            isPublic: publicDraft.isPublic,
            publicTitle: publicDraft.publicTitle.trim(),
            publicDescription: publicDraft.publicDescription.trim(),
            publicStatus: publicDraft.publicStatus,
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as { request?: DetailResponse["request"]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "update_public_visibility_failed");
      }
      setNotice(t("supportManagement.notice.publicUpdated"));
      await openDetail({
        ...selected,
        isPublic: data.request?.isPublic ?? publicDraft.isPublic,
        publicTitle: data.request?.publicTitle ?? publicDraft.publicTitle,
        publicDescription: data.request?.publicDescription ?? publicDraft.publicDescription,
        publicStatus: data.request?.publicStatus ?? publicDraft.publicStatus,
        publicPublishedAt: data.request?.publicPublishedAt ?? selected.publicPublishedAt,
        publicPublishedByUid: data.request?.publicPublishedByUid ?? selected.publicPublishedByUid,
        publicUpdatedAt: data.request?.publicUpdatedAt ?? selected.publicUpdatedAt,
        updatedAt: data.request?.updatedAt ?? selected.updatedAt,
      });
      await load();
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : "update_public_visibility_failed");
    } finally {
      setIsSaving(false);
    }
  }

  const cards = summary
    ? [
        ["total", summary.total],
        ["new", summary.byStatus.new],
        ["triaged", summary.byStatus.triaged],
        ["planned", summary.byStatus.planned],
        ["in_progress", summary.byStatus.in_progress],
        ["done", summary.byStatus.done],
        ["declined", summary.byStatus.declined],
        ["duplicate", summary.byStatus.duplicate],
        ["bugs", summary.byType.bug],
        ["features", summary.byType.feature],
        ["highSeverityBugs", summary.highSeverityBugs],
      ]
    : [];

  return (
    <SupportConsoleShell
      activeModule="requests"
      title={t("supportManagement.title")}
      subtitle={t("supportManagement.subtitle")}
      actions={
        <>
          <Button
            type="button"
            className="btn btn-secondary"
            disabled={isRebuildingSnapshot}
            onClick={() => void rebuildSnapshot()}
          >
            {isRebuildingSnapshot
              ? t("supportManagement.actions.rebuilding")
              : t("supportManagement.actions.rebuildSnapshot")}
          </Button>
        </>
      }>

      {error ? <Alert>{t("supportManagement.errors.load", { error })}</Alert> : null}
      {notice ? (
        <Alert tone="success" role="status">
          {notice}
        </Alert>
      ) : null}

      {isLoading ? <SupportRequestsSkeleton /> : null}
      {!isLoading && summary && list ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(([key, value]) => (
              <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t(`supportManagement.cards.${key}`)}
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
              </article>
            ))}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-3 xl:grid-cols-5">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.search")}
                <input value={filters.q} onChange={(event) => setFilters((c) => ({ ...c, q: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.type")}
                <select value={filters.type} onChange={(event) => setFilters((c) => ({ ...c, type: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="all">{t("supportManagement.filters.allTypes")}</option>
                  <option value="bug">{t("support.type.bug")}</option>
                  <option value="feature">{t("support.type.feature")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.status")}
                <select value={filters.status} onChange={(event) => setFilters((c) => ({ ...c, status: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="all">{t("supportManagement.filters.allStatuses")}</option>
                  {Object.keys(summary.byStatus).map((status) => (
                    <option key={status} value={status}>{t(`support.status.${status}`)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.severity")}
                <select value={filters.severity} onChange={(event) => setFilters((c) => ({ ...c, severity: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="all">{t("supportManagement.filters.allSeverities")}</option>
                  <option value="low">{t("support.severity.low")}</option>
                  <option value="medium">{t("support.severity.medium")}</option>
                  <option value="high">{t("support.severity.high")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.category")}
                <select value={filters.category} onChange={(event) => setFilters((c) => ({ ...c, category: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="all">{t("support.categoryAll")}</option>
                  <optgroup label={t("support.type.feature")}>
                    {FEATURE_CATEGORY_KEYS.map((key) => (
                      <option key={key} value={key}>{t(`support.categories.${key}`)}</option>
                    ))}
                  </optgroup>
                  <optgroup label={t("support.type.bug")}>
                    {BUG_CATEGORY_KEYS.map((key) => (
                      <option key={key} value={key}>{t(`support.categories.${key}`)}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.sort")}
                <select value={`${filters.sortBy}:${filters.sortDir}`} onChange={(event) => {
                  const [sortBy, sortDir] = event.target.value.split(":");
                  setFilters((c) => ({ ...c, sortBy, sortDir: sortDir as "asc" | "desc", page: 1 }));
                }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="updatedAt:desc">{t("supportManagement.sort.updatedDesc")}</option>
                  <option value="createdAt:desc">{t("supportManagement.sort.createdDesc")}</option>
                  <option value="severity:asc">{t("supportManagement.sort.severity")}</option>
                  <option value="status:asc">{t("supportManagement.sort.status")}</option>
                  <option value="type:asc">{t("supportManagement.sort.type")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.family")}
                <input value={filters.familyId} onChange={(event) => setFilters((c) => ({ ...c, familyId: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.reporter")}
                <input value={filters.reporter} onChange={(event) => setFilters((c) => ({ ...c, reporter: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.createdFrom")}
                <input type="date" value={filters.createdFrom} onChange={(event) => setFilters((c) => ({ ...c, createdFrom: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {t("supportManagement.filters.createdTo")}
                <input type="date" value={filters.createdTo} onChange={(event) => setFilters((c) => ({ ...c, createdTo: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <div className="flex items-end">
                <Button type="button" className="btn btn-secondary" onClick={() => void load()}>
                  {t("supportManagement.actions.refresh")}
                </Button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">{t("supportManagement.columns.type")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.subject")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.status")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.severity")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.category")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.reporter")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.family")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.created")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.updated")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.page")}</th>
                    <th className="px-3 py-2">{t("supportManagement.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.requests.map((request) => (
                    <tr key={`${request.familyId}:${request.id}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2"><EnumChip label={t(`support.type.${request.type}`)} tone={request.type === "bug" ? "rose" : "violet"} /></td>
                      <td className="px-3 py-2"><div className="font-semibold text-slate-900">{request.subject}</div><div className="max-w-sm text-xs text-slate-500">{request.descriptionPreview}</div></td>
                      <td className="px-3 py-2"><EnumChip label={t(`support.status.${request.status}`)} tone={statusTone(request.status)} /></td>
                      <td className="px-3 py-2">{request.severity ? <EnumChip label={t(`support.severity.${request.severity}`)} tone={severityTone(request.severity)} /> : <span className="small">{t("supportManagement.severityNone")}</span>}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{request.category ? (t(`support.categories.${request.category}`) !== `support.categories.${request.category}` ? t(`support.categories.${request.category}`) : request.category) : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2"><div>{request.createdByDisplayName || "-"}</div><div className="text-xs text-slate-500">{request.createdByEmail || request.createdByUid || "-"}</div></td>
                      <td className="px-3 py-2"><div>{request.familyName || t("supportManagement.familyFallback")}</div><div className="text-xs text-slate-500">{request.familyId}</div></td>
                      <td className="px-3 py-2">{formatDateTime(request.createdAt, locale)}</td>
                      <td className="px-3 py-2">{formatDateTime(request.updatedAt, locale)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{request.pageUrl || "-"}</td>
                      <td className="px-3 py-2"><Button type="button" className="btn btn-secondary" onClick={() => void openDetail(request)}>{t("supportManagement.actions.view")}</Button></td>
                    </tr>
                  ))}
                  {list.requests.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-6 text-center text-sm text-slate-500">{t("supportManagement.empty")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <span className="small">{t("supportManagement.pager.pageOf", list.pagination)}</span>
              <div className="flex gap-2">
                <Button type="button" className="btn btn-secondary" disabled={list.pagination.page <= 1} onClick={() => setFilters((c) => ({ ...c, page: Math.max(1, c.page - 1) }))}>{t("supportManagement.pager.previous")}</Button>
                <Button type="button" className="btn btn-secondary" disabled={list.pagination.page >= list.pagination.totalPages} onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}>{t("supportManagement.pager.next")}</Button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <ModalShell open={selected !== null} onRequestClose={() => setSelected(null)}>
        <div className="family-modal-card w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="modal-dialog-title-row family-modal-title-row mb-3">
            <h2 className="family-modal-title">{t("supportManagement.detailTitle")}</h2>
            <Button type="button" className="modal-close-button" onClick={() => setSelected(null)} aria-label={t("common.actions.close")} title={t("common.actions.close")}>X</Button>
          </div>
          {isDetailLoading ? <SupportRequestsSkeleton /> : null}
          {!isDetailLoading && detailError ? <Alert>{t("supportManagement.errors.detail", { error: detailError })}</Alert> : null}
          {!isDetailLoading && detail ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.subject")}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{detail.request.subject}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.type")}</div><div className="mt-1">{t(`support.type.${detail.request.type}`)}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.severity")}</div><div className="mt-1">{detail.request.severity ? t(`support.severity.${detail.request.severity}`) : t("supportManagement.severityNone")}</div></div>
                  <div className="sm:col-span-2"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.category")}</div><div className="mt-1 text-sm">{detail.request.category ? (t(`support.categories.${detail.request.category}`) !== `support.categories.${detail.request.category}` ? t(`support.categories.${detail.request.category}`) : detail.request.category) : <span className="text-slate-400">{t("supportManagement.categoryNone")}</span>}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.created")}</div><div className="mt-1">{formatDateTime(detail.request.createdAt, locale)}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.updated")}</div><div className="mt-1">{formatDateTime(detail.request.updatedAt, locale)}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.reporter")}</div><div className="mt-1">{detail.request.createdByDisplayName || "-"}</div><div className="text-xs text-slate-500">{detail.request.createdByEmail || detail.request.createdByUid || "-"}</div></div>
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.family")}</div><div className="mt-1">{detail.request.familyName || t("supportManagement.familyFallback")}</div><div className="text-xs text-slate-500">{detail.request.familyId}</div></div>
                </div>
                <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.page")}</div><div className="mt-1 break-all text-sm text-slate-700">{detail.request.pageUrl || "-"}</div></div>
                <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.description")}</div><div className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{detail.request.description}</div></div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.history")}</div>
                  <div className="mt-2 space-y-2">
                    {detail.history.length ? detail.history.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="font-semibold text-slate-900">
                          {t(`support.status.${entry.previousStatus}`)}
                          {" -> "}
                          {t(`support.status.${entry.nextStatus}`)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(entry.createdAt, locale)}
                          {" | "}
                          {entry.changedByEmail || entry.changedByUid || "-"}
                        </div>
                        {entry.note ? <div className="mt-1 text-slate-700">{entry.note}</div> : null}
                      </div>
                    )) : <p className="small">{t("supportManagement.noHistory")}</p>}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.activity")}</div>
                  <div className="mt-2 space-y-2">
                    {detail.activity.length ? detail.activity.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="font-semibold text-slate-900">{entry.eventType}</div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(entry.createdAt, locale)}
                          {" | "}
                          {entry.actorEmail || entry.actorUid || "-"}
                        </div>
                        <div className="mt-1 text-slate-700">
                          {entry.reason || `${entry.previousStatus} -> ${entry.nextStatus}`}
                        </div>
                      </div>
                    )) : <p className="small">{t("supportManagement.noActivity")}</p>}
                  </div>
                </div>
              </div>
              <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{t("supportManagement.manageStatus")}</div>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("supportManagement.filters.status")}
                  <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as SupportRequestStatus)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                    {detail.statuses.map((status) => <option key={status} value={status}>{t(`support.status.${status}`)}</option>)}
                  </select>
                </label>
                <div className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("supportManagement.categoryLabel")}
                  <CategorySelector
                    type={detail.request.type}
                    value={categoryDraft}
                    onChange={setCategoryDraft}
                    labelFor={(key) => t(`support.categories.${key}`)}
                    selectClassName="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    inputClassName="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    placeholder={t("support.categoryPlaceholder")}
                    customPlaceholder={t("support.categoryCustomPlaceholder")}
                    customLabel={t("supportManagement.categoryLabel")}
                  />
                  <span className="text-xs font-normal text-slate-500">{t("supportManagement.categoryHint")}</span>
                </div>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("supportManagement.internalNote")}
                  <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={5} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                </label>
                <div className="text-xs text-slate-500">{t("supportManagement.reportingHint", { recent: summary?.recentCreatedLast7Days ?? 0, closed: summary?.closedLast7Days ?? 0, average: summary?.averageHoursToClose ?? "-" })}</div>
                <Button type="button" className="btn btn-primary w-full" disabled={isSaving} onClick={() => void saveStatus()}>{isSaving ? t("supportManagement.actions.saving") : t("supportManagement.actions.updateStatus")}</Button>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="text-sm font-semibold text-slate-900">{t("supportManagement.public.title")}</div>
                  <Alert tone="warning">{t("supportManagement.public.warning")}</Alert>
                  <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={publicDraft.isPublic}
                      onChange={(event) => setPublicDraft((current) => ({ ...current, isPublic: event.target.checked }))}
                    />
                    {t("supportManagement.public.isPublic")}
                  </label>
                  <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-slate-700">
                    {t("supportManagement.public.publicTitle")}
                    <input
                      value={publicDraft.publicTitle}
                      onChange={(event) => setPublicDraft((current) => ({ ...current, publicTitle: event.target.value }))}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-slate-700">
                    {t("supportManagement.public.publicDescription")}
                    <textarea
                      value={publicDraft.publicDescription}
                      onChange={(event) => setPublicDraft((current) => ({ ...current, publicDescription: event.target.value }))}
                      rows={5}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    />
                  </label>
                  <label className="mt-3 flex flex-col gap-1 text-sm font-semibold text-slate-700">
                    {t("supportManagement.public.publicStatus")}
                    <select
                      value={publicDraft.publicStatus}
                      onChange={(event) =>
                        setPublicDraft((current) => ({
                          ...current,
                          publicStatus: event.target.value as PublicSupportRequestStatus,
                        }))
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    >
                      {PUBLIC_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`changeLog.requested.status.${status}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    className="btn btn-primary mt-3 w-full"
                    disabled={isSaving}
                    onClick={() => void savePublicVisibility()}
                  >
                    {isSaving ? t("supportManagement.actions.saving") : t("supportManagement.public.save")}
                  </Button>
                </div>
                <div className="mt-2 border-t border-slate-200 pt-3">
                  <div className="text-xs text-slate-500">{t("supportManagement.deleteHint")}</div>
                  {deleteConfirming ? (
                    <div className="mt-2 flex gap-2">
                      <Button type="button" className="btn btn-secondary flex-1" disabled={deletePending} onClick={() => setDeleteConfirming(false)}>
                        {t("common.actions.cancel")}
                      </Button>
                      <Button type="button" className="btn btn-danger flex-1" disabled={deletePending} onClick={() => void deleteRequest()}>
                        {deletePending ? t("supportManagement.actions.deletePending") : t("supportManagement.actions.deleteConfirm")}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" className="btn btn-danger mt-2 w-full" disabled={deletePending} onClick={() => setDeleteConfirming(true)}>
                      {t("supportManagement.actions.delete")}
                    </Button>
                  )}
                </div>
              </aside>
            </div>
          ) : null}
        </div>
      </ModalShell>
    </SupportConsoleShell>
  );
}
