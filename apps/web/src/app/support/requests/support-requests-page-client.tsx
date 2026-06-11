"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { AppTabs } from "@/components/app-tabs";
import { Button } from "@/components/button";
import { EnumChip } from "@/components/enum-chip";
import { FilterMenuIcon } from "@/components/filter-menu-icon";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";
import { CategorySelector } from "@/components/category-selector";
import { SupportMetricsStrip, type SupportMetric } from "@/components/support-metrics-strip";
import { SupportConsoleShell } from "@/components/support-console-shell";
import {
  BUG_CATEGORY_KEYS,
  FEATURE_CATEGORY_KEYS,
  SUPPORT_REQUEST_IMPORTANCES,
  type PublicSupportRequestStatus,
  type SupportRequestImportance,
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
  importance: SupportRequestImportance | null;
  category: string;
  createdByUid: string;
  createdByDisplayName: string;
  createdByEmail: string;
  allowContact: boolean;
  notifyOnStatusChange: boolean;
  assignedToUid: string;
  assignedToEmail: string;
  allowVoting: boolean;
  votesCount: number;
  relatedChangelogEntryId: string;
  duplicateOfId: string;
  relatedTicketIds: string[];
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  isPublic: boolean;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
  publicPublishedAt: string;
  publicPublishedByUid: string;
  publicUpdatedAt: string;
};

const TYPE_TONE = {
  bug: "rose",
  feature: "violet",
  question: "blue",
  feedback: "teal",
} as const;

type Summary = {
  total: number;
  byStatus: Record<SupportRequestStatus, number>;
  byType: Record<SupportRequestType, number>;
  openByType: Record<SupportRequestType, number>;
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
  request: ListRecord & {
    description: string;
    userAgent: string;
    diagnostics: {
      browser: string;
      operatingSystem: string;
      screenResolution: string;
      language: string;
      appVersion: string;
      recentConsoleErrors: string;
      recentApiFailures: string;
    };
  };
  notes: Array<{
    id: string;
    body: string;
    authorUid: string;
    authorEmail: string;
    authorName: string;
    createdAt: string;
  }>;
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
  importance: string;
  category: string;
  familyId: string;
  reporter: string;
  assignee: string;
  createdFrom: string;
  createdTo: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  page: number;
};

type QuickFilterId = "open" | "bug" | "feature" | "feedback" | "question";
type DetailTabId = "request" | "notes" | "details" | "audit";

const PAGE_SIZE = 20;
const PUBLIC_STATUSES: PublicSupportRequestStatus[] = [
  "under_review",
  "planned",
  "in_progress",
  "completed",
  "declined",
];

function statusTone(status: SupportRequestStatus) {
  if (status === "done" || status === "released") return "green";
  if (status === "closed" || status === "cancelled") return "slate";
  if (status === "declined" || status === "duplicate") return "rose";
  if (status === "in_progress" || status === "needs_info") return "amber";
  if (status === "planned") return "violet";
  if (status === "triaged") return "indigo";
  return "blue";
}

function severityTone(severity: SupportRequestSeverity) {
  return severity === "high" ? "rose" : severity === "medium" ? "amber" : "teal";
}

function importanceTone(importance: SupportRequestImportance) {
  if (importance === "blocking") return "rose";
  if (importance === "very_important") return "amber";
  if (importance === "useful") return "indigo";
  return "slate";
}

function priorityTone(request: ListRecord) {
  if (request.severity) {
    return severityTone(request.severity);
  }
  if (request.importance) {
    return importanceTone(request.importance);
  }
  return "slate";
}

function formatDateTime(value: string, locale: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(locale) : "-";
}

function formatRelativeDuration(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  const diffMs = Math.max(0, Date.now() - parsed);
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const totalMinutes = Math.floor(diffMs / (1000 * 60));

  if (totalMinutes < 1) return "Just now";
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"} ago`;
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? "" : "s"} ago`;

  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const weeks = Math.floor((totalDays % 30) / 7);
  const days = totalDays % 7;
  const parts: string[] = [];

  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (weeks > 0 && parts.length < 2) parts.push(`${weeks} week${weeks === 1 ? "" : "s"}`);
  if (days > 0 && parts.length < 2) parts.push(`${days} day${days === 1 ? "" : "s"}`);

  if (parts.length === 0) return `${totalDays} day${totalDays === 1 ? "" : "s"} ago`;
  return `${parts.slice(0, 2).join(" ")} ago`;
}

function SortableHeader({
  label,
  sortKey,
  filters,
  onToggle,
}: {
  label: string;
  sortKey: string;
  filters: Filters;
  onToggle: (sortKey: string) => void;
}) {
  const active = filters.sortBy === sortKey;
  const indicator = !active ? "" : filters.sortDir === "asc" ? " ↑" : " ↓";

  return (
    <button
      type="button"
      className={`table-sort-btn${active ? " table-sort-btn-active" : ""}`}
      onClick={() => onToggle(sortKey)}>
      <span>{label}</span>
      <span aria-hidden="true">{indicator}</span>
    </button>
  );
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
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuildingSnapshot, setIsRebuildingSnapshot] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTabId>("request");
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusDraft, setStatusDraft] = useState<SupportRequestStatus>("new");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [publicMessageDraft, setPublicMessageDraft] = useState("");
  const [manageDraft, setManageDraft] = useState({
    assignedToUid: "",
    assignedToEmail: "",
    allowVoting: false,
    relatedChangelogEntryId: "",
    duplicateOfId: "",
    relatedTicketIds: "",
  });
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [publicDraft, setPublicDraft] = useState({
    isPublic: false,
    publicTitle: "",
    publicDescription: "",
    publicStatus: "under_review" as PublicSupportRequestStatus,
  });
  const [filters, setFilters] = useState<Filters>({
    q: "",
    type: "all",
    status: "open",
    severity: "all",
    importance: "all",
    category: "all",
    familyId: "",
    reporter: "",
    assignee: "",
    createdFrom: "",
    createdTo: "",
    sortBy: "updatedAt",
    sortDir: "desc",
    page: 1,
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [quickFiltersMenuOpen, setQuickFiltersMenuOpen] = useState(false);
  const hasSkippedFirstTableRefresh = useRef(false);

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
    if (filters.importance !== "all") params.set("importance", filters.importance);
    if (filters.category !== "all") params.set("category", filters.category);
    if (filters.familyId.trim()) params.set("familyId", filters.familyId.trim());
    if (filters.reporter.trim()) params.set("reporter", filters.reporter.trim());
    if (filters.assignee.trim()) params.set("assignee", filters.assignee.trim());
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    return params.toString();
  }, [filters]);

  const loadSummary = useCallback(async () => {
    const summaryResponse = await fetch("/api/support/requests/summary", { cache: "no-store" });
    const summaryJson = (await summaryResponse.json().catch(() => ({}))) as {
      summary?: Summary;
      error?: string;
    };
    if (!summaryResponse.ok) {
      throw new Error(summaryJson.error ?? "support_requests_unavailable");
    }
    setSummary(summaryJson.summary ?? null);
  }, []);

  const loadList = useCallback(async () => {
    const listResponse = await fetch(`/api/support/requests?${queryString}`, { cache: "no-store" });
    const listJson = (await listResponse.json().catch(() => ({}))) as ListResponse & {
      error?: string;
    };
    if (!listResponse.ok) {
      throw new Error(listJson.error ?? "support_requests_unavailable");
    }
    setList(listJson);
  }, [queryString]);

  const reloadSummaryAndList = useCallback(async () => {
    setIsTableLoading(true);
    setError("");
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "support_requests_unavailable");
    } finally {
      setIsTableLoading(false);
    }
  }, [loadList, loadSummary]);

  useEffect(() => {
    if (hasLoadedInitialData) {
      return;
    }

    async function boot() {
      setIsLoading(true);
      setError("");
      try {
        await Promise.all([loadSummary(), loadList()]);
        setHasLoadedInitialData(true);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "support_requests_unavailable");
      } finally {
        setIsLoading(false);
      }
    }

    void boot();
  }, [loadList, loadSummary]);

  useEffect(() => {
    if (!hasLoadedInitialData) {
      return;
    }
    if (!hasSkippedFirstTableRefresh.current) {
      hasSkippedFirstTableRefresh.current = true;
      return;
    }

    async function refreshTable() {
      setIsTableLoading(true);
      setError("");
      try {
        await loadList();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "support_requests_unavailable");
      } finally {
        setIsTableLoading(false);
      }
    }

    void refreshTable();
  }, [hasLoadedInitialData, loadList]);

  async function openDetail(request: ListRecord) {
    setSelected(request);
    setDetail(null);
    setDetailError("");
    setDeleteConfirming(false);
    setDetailTab("request");
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
      setPublicMessageDraft("");
      setNewNote("");
      setManageDraft({
        assignedToUid: data.request.assignedToUid ?? "",
        assignedToEmail: data.request.assignedToEmail ?? "",
        allowVoting: data.request.allowVoting ?? false,
        relatedChangelogEntryId: data.request.relatedChangelogEntryId ?? "",
        duplicateOfId: data.request.duplicateOfId ?? "",
        relatedTicketIds: (data.request.relatedTicketIds ?? []).join(", "),
      });
      setPublicDraft({
        isPublic: data.request.isPublic,
        publicTitle: data.request.publicTitle || data.request.subject,
        publicDescription: data.request.publicDescription || data.request.description,
        publicStatus: data.request.publicStatus,
      });
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "support_request_unavailable");
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function saveRequest() {
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
          category: categoryDraft.trim() || undefined,
          assignedToUid: manageDraft.assignedToUid.trim(),
          assignedToEmail: manageDraft.assignedToEmail.trim(),
          allowVoting: manageDraft.allowVoting,
          relatedChangelogEntryId: manageDraft.relatedChangelogEntryId.trim(),
          duplicateOfId: manageDraft.duplicateOfId.trim(),
          relatedTicketIds: manageDraft.relatedTicketIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          publicMessage: publicMessageDraft.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { request?: DetailResponse["request"]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "update_support_request_failed");
      }
      const publicResponse = await fetch(
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
      const publicData = (await publicResponse.json().catch(() => ({}))) as {
        request?: DetailResponse["request"];
        error?: string;
      };
      if (!publicResponse.ok) {
        throw new Error(publicData.error ?? "update_public_visibility_failed");
      }
      setNotice(t("supportManagement.notice.statusUpdated"));
      await openDetail({
        ...selected,
        status: data.request?.status ?? statusDraft,
        category: data.request?.category ?? categoryDraft.trim(),
        assignedToUid: data.request?.assignedToUid ?? manageDraft.assignedToUid.trim(),
        assignedToEmail: data.request?.assignedToEmail ?? manageDraft.assignedToEmail.trim(),
        allowVoting: data.request?.allowVoting ?? manageDraft.allowVoting,
        relatedChangelogEntryId: data.request?.relatedChangelogEntryId ?? manageDraft.relatedChangelogEntryId.trim(),
        duplicateOfId: data.request?.duplicateOfId ?? manageDraft.duplicateOfId.trim(),
        relatedTicketIds: data.request?.relatedTicketIds ??
          manageDraft.relatedTicketIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        isPublic: publicData.request?.isPublic ?? publicDraft.isPublic,
        publicTitle: publicData.request?.publicTitle ?? publicDraft.publicTitle,
        publicDescription: publicData.request?.publicDescription ?? publicDraft.publicDescription,
        publicStatus: publicData.request?.publicStatus ?? publicDraft.publicStatus,
        publicPublishedAt: publicData.request?.publicPublishedAt ?? selected.publicPublishedAt,
        publicPublishedByUid: publicData.request?.publicPublishedByUid ?? selected.publicPublishedByUid,
        publicUpdatedAt: publicData.request?.publicUpdatedAt ?? selected.publicUpdatedAt,
        updatedAt: publicData.request?.updatedAt ?? data.request?.updatedAt ?? selected.updatedAt,
      });
      await reloadSummaryAndList();
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
      await reloadSummaryAndList();
    } catch (deleteErr) {
      setDetailError(deleteErr instanceof Error ? deleteErr.message : "delete_failed");
    } finally {
      setDeletePending(false);
    }
  }

  async function addNote() {
    if (!selected || !detail || isAddingNote || !newNote.trim()) {
      return;
    }
    setIsAddingNote(true);
    setDetailError("");
    try {
      const response = await fetch(
        `/api/support/requests/${encodeURIComponent(selected.id)}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ familyId: selected.familyId, body: newNote.trim() }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        notes?: DetailResponse["notes"];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "add_note_failed");
      }
      setDetail((current) => (current ? { ...current, notes: data.notes ?? current.notes } : current));
      setNewNote("");
      setNotice(t("supportManagement.notice.noteAdded"));
    } catch (noteError) {
      setDetailError(noteError instanceof Error ? noteError.message : "add_note_failed");
    } finally {
      setIsAddingNote(false);
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

  const metrics = useMemo<SupportMetric[]>(() => {
    if (!summary) {
      return [];
    }

    return [
      {
        label: t("supportManagement.cards.newRequests"),
        value: summary.byStatus.new,
        tone: "sky",
      },
      {
        label: t("supportManagement.cards.activeBugs"),
        value: summary.openByType.bug,
        detail: t("supportManagement.cards.activeBugsDetail"),
        tone: "rose",
      },
      {
        label: t("supportManagement.cards.feedbackOpen"),
        value: summary.openByType.feedback,
        tone: "violet",
      },
      {
        label: t("supportManagement.cards.questionsOpen"),
        value: summary.openByType.question,
        tone: "emerald",
      },
    ];
  }, [summary, t]);

  const activeQuickFilterId = useMemo<QuickFilterId | null>(() => {
    const hasOnlyQuickFilterFields =
      filters.q.trim() === "" &&
      filters.severity === "all" &&
      filters.importance === "all" &&
      filters.category === "all" &&
      filters.familyId.trim() === "" &&
      filters.reporter.trim() === "" &&
      filters.assignee.trim() === "" &&
      filters.createdFrom === "" &&
      filters.createdTo === "";

    if (!hasOnlyQuickFilterFields || filters.status !== "open") {
      return null;
    }
    if (filters.type === "all") {
      return "open";
    }
    if (filters.type === "bug") {
      return "bug";
    }
    if (filters.type === "feature") {
      return "feature";
    }
    if (filters.type === "feedback") {
      return "feedback";
    }
    if (filters.type === "question") {
      return "question";
    }
    return null;
  }, [filters]);

  const detailTabs = useMemo(
    () => [
      { id: "request", label: t("supportManagement.tabs.request") },
      { id: "notes", label: t("supportManagement.tabs.notes") },
      { id: "details", label: t("supportManagement.tabs.details") },
      { id: "audit", label: t("supportManagement.tabs.audit") },
    ] satisfies Array<{ id: DetailTabId; label: string }>,
    [t],
  );

  const auditTimeline = useMemo(() => {
    if (!detail) {
      return [];
    }

    return [
      ...detail.history.map((entry) => ({
        id: `history-${entry.id}`,
        createdAt: entry.createdAt,
        kind: "status" as const,
        actor: entry.changedByEmail || entry.changedByUid || "-",
        title: `${t(`support.status.${entry.previousStatus}`)} -> ${t(`support.status.${entry.nextStatus}`)}`,
        body: entry.note || "",
      })),
      ...detail.activity.map((entry) => ({
        id: `activity-${entry.id}`,
        createdAt: entry.createdAt,
        kind: "activity" as const,
        actor: entry.actorEmail || entry.actorName || entry.actorUid || "-",
        title: entry.eventType,
        body: entry.reason || [entry.previousStatus, entry.nextStatus].filter(Boolean).join(" -> "),
      })),
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }, [detail, t]);

  const quickFilterItems = useMemo(() => {
    if (!summary) {
      return [];
    }

    const items: Array<{
      id: QuickFilterId;
      label: string;
      count: number;
      active: boolean;
    }> = [
      {
        id: "open",
        label: t("supportManagement.quickFilters.open"),
        count:
          summary.openByType.bug +
          summary.openByType.feature +
          summary.openByType.feedback +
          summary.openByType.question,
        active: activeQuickFilterId === "open",
      },
      {
        id: "bug",
        label: t("supportManagement.quickFilters.bugs"),
        count: summary.openByType.bug,
        active: activeQuickFilterId === "bug",
      },
      {
        id: "feature",
        label: t("supportManagement.quickFilters.features"),
        count: summary.openByType.feature,
        active: activeQuickFilterId === "feature",
      },
      {
        id: "feedback",
        label: t("supportManagement.quickFilters.feedback"),
        count: summary.openByType.feedback,
        active: activeQuickFilterId === "feedback",
      },
      {
        id: "question",
        label: t("supportManagement.quickFilters.questions"),
        count: summary.openByType.question,
        active: activeQuickFilterId === "question",
      },
    ];

    return items;
  }, [activeQuickFilterId, summary, t]);

  function applyQuickFilter(id: QuickFilterId) {
    const typeById: Record<QuickFilterId, Filters["type"]> = {
      open: "all",
      bug: "bug",
      feature: "feature",
      feedback: "feedback",
      question: "question",
    };

    setFilters((current) => ({
      ...current,
      q: "",
      type: typeById[id],
      status: "open",
      severity: "all",
      importance: "all",
      category: "all",
      familyId: "",
      reporter: "",
      assignee: "",
      createdFrom: "",
      createdTo: "",
      page: 1,
    }));
  }

  function toggleSort(sortBy: string) {
    setFilters((current) => ({
      ...current,
      sortBy,
      sortDir: current.sortBy === sortBy && current.sortDir === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }

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
          <SupportMetricsStrip metrics={metrics} forceSingleRow />

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
                  {quickFilterItems.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      className={`support-requests-quick-filter-chip${item.active ? " is-active" : ""}`}
                      onClick={() => applyQuickFilter(item.id)}>
                      <span>{item.label}</span>
                      <span className="support-requests-quick-filter-chip-count">{item.count}</span>
                    </Button>
                  ))}
                </div>
                <div className="lg:hidden">
                  <AppMenu
                    open={quickFiltersMenuOpen}
                    onOpenChange={setQuickFiltersMenuOpen}
                    triggerClassName={activeQuickFilterId ? "btn btn-primary" : "btn btn-secondary"}
                    triggerAriaLabel={t("supportManagement.actions.quickFilters")}
                    trigger={t("supportManagement.actions.quickFilters")}
                    panelClassName="app-menu-panel family-action-dropdown">
                    {quickFilterItems.map((item) => (
                      <MenuActionButton
                        key={item.id}
                        fullWidth
                        className={item.active ? "menu-action-link-active" : ""}
                        trailing={item.count}
                        trailingClassName="text-xs font-semibold text-slate-500"
                        onClick={() => {
                          setQuickFiltersMenuOpen(false);
                          applyQuickFilter(item.id);
                        }}>
                        {item.label}
                      </MenuActionButton>
                    ))}
                  </AppMenu>
                </div>

                <div className="lg:ml-auto">
                  <Button
                    type="button"
                    className="btn btn-secondary inline-flex items-center gap-2"
                    aria-expanded={showAdvancedFilters}
                    aria-controls="support-requests-advanced-filters"
                    onClick={() => setShowAdvancedFilters((current) => !current)}>
                    {t("supportManagement.actions.advanced")}
                    <FilterMenuIcon />
                  </Button>
                </div>
              </div>
            </div>

            {showAdvancedFilters ? (
              <div
                id="support-requests-advanced-filters"
                className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-3 xl:grid-cols-5">
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
                  <option value="question">{t("support.type.question")}</option>
                  <option value="feedback">{t("support.type.feedback")}</option>
                </select>
              </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("supportManagement.filters.status")}
                  <select value={filters.status} onChange={(event) => setFilters((c) => ({ ...c, status: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                    <option value="open">{t("supportManagement.quickFilters.open")}</option>
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
                {t("supportManagement.filters.importance")}
                <select value={filters.importance} onChange={(event) => setFilters((c) => ({ ...c, importance: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                  <option value="all">{t("supportManagement.filters.allImportances")}</option>
                  {SUPPORT_REQUEST_IMPORTANCES.map((key) => (
                    <option key={key} value={key}>{t(`support.importance.${key}`)}</option>
                  ))}
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
                  <option value="reporter:asc">{t("supportManagement.sort.reporter")}</option>
                  <option value="priority:asc">{t("supportManagement.sort.priority")}</option>
                  <option value="status:asc">{t("supportManagement.sort.status")}</option>
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
                {t("supportManagement.filters.assignee")}
                <input value={filters.assignee} placeholder={t("supportManagement.filters.assigneePlaceholder")} onChange={(event) => setFilters((c) => ({ ...c, assignee: event.target.value, page: 1 }))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
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
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isTableLoading}
                  onClick={() => void reloadSummaryAndList()}>
                  {t("supportManagement.actions.apply")}
                </Button>
              </div>
              </div>
            ) : null}

            <div
              className={`overflow-auto transition-opacity${isTableLoading ? " opacity-60" : ""}`}
              aria-busy={isTableLoading}>
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">
                      <SortableHeader label={t("supportManagement.columns.reporter")} sortKey="reporter" filters={filters} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2">{t("supportManagement.columns.subject")}</th>
                    <th className="px-3 py-2">
                      <SortableHeader label={t("supportManagement.columns.status")} sortKey="status" filters={filters} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2">
                      <SortableHeader label={t("supportManagement.columns.priority")} sortKey="priority" filters={filters} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2">
                      <SortableHeader label={t("supportManagement.columns.created")} sortKey="createdAt" filters={filters} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2">
                      <SortableHeader label={t("supportManagement.columns.updated")} sortKey="updatedAt" filters={filters} onToggle={toggleSort} />
                    </th>
                    <th className="support-requests-actions-cell support-requests-actions-header px-3 py-2">{t("supportManagement.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.requests.map((request) => (
                    <tr key={`${request.familyId}:${request.id}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{request.createdByDisplayName || "-"}</span>
                          <EnumChip label={t(`support.type.${request.type}`)} tone={TYPE_TONE[request.type] ?? "slate"} />
                        </div>
                        <div className="text-xs text-slate-500">{request.createdByEmail || request.createdByUid || "-"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="support-requests-subject-cell">
                          <div className="font-semibold text-slate-900">{request.subject}</div>
                          <div className="text-xs text-slate-500">{request.descriptionPreview}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><EnumChip label={t(`support.status.${request.status}`)} tone={statusTone(request.status)} /></td>
                      <td className="px-3 py-2">
                        {request.severity ? (
                          <EnumChip label={t(`support.severity.${request.severity}`)} tone={priorityTone(request)} />
                        ) : request.importance ? (
                          <EnumChip label={t(`support.importance.${request.importance}`)} tone={priorityTone(request)} />
                        ) : (
                          <span className="small">{t("supportManagement.severityNone")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2" title={formatDateTime(request.createdAt, locale)}>{formatRelativeDuration(request.createdAt)}</td>
                      <td className="px-3 py-2" title={formatDateTime(request.updatedAt, locale)}>{formatRelativeDuration(request.updatedAt)}</td>
                      <td className="support-requests-actions-cell px-3 py-2"><Button type="button" className="btn btn-secondary" onClick={() => void openDetail(request)}>{t("supportManagement.actions.view")}</Button></td>
                    </tr>
                  ))}
                  {list.requests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">{t("supportManagement.empty")}</td>
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
            <div className="space-y-4">
              <AppTabs
                ariaLabel={t("supportManagement.detailTabsLabel")}
                tabs={detailTabs}
                activeTab={detailTab}
                onChange={setDetailTab}
              />

              {detailTab === "request" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <aside className="space-y-4">
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
                      {t("supportManagement.assignee")}
                      <input value={manageDraft.assignedToEmail} onChange={(event) => setManageDraft((current) => ({ ...current, assignedToEmail: event.target.value }))} placeholder={t("supportManagement.assigneeEmailPlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                      <input value={manageDraft.assignedToUid} onChange={(event) => setManageDraft((current) => ({ ...current, assignedToUid: event.target.value }))} placeholder={t("supportManagement.assigneeUidPlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={manageDraft.allowVoting} onChange={(event) => setManageDraft((current) => ({ ...current, allowVoting: event.target.checked }))} />
                      {t("supportManagement.allowVoting")}
                      <span className="text-xs font-normal text-slate-500">({detail.request.votesCount} {t("supportManagement.votes")})</span>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                      {t("supportManagement.changelogEntryId")}
                      <input value={manageDraft.relatedChangelogEntryId} onChange={(event) => setManageDraft((current) => ({ ...current, relatedChangelogEntryId: event.target.value }))} placeholder={t("supportManagement.changelogEntryIdPlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                      {t("supportManagement.duplicateOfId")}
                      <input value={manageDraft.duplicateOfId} onChange={(event) => setManageDraft((current) => ({ ...current, duplicateOfId: event.target.value }))} placeholder={t("supportManagement.duplicateOfIdPlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                      {t("supportManagement.relatedTicketIds")}
                      <input value={manageDraft.relatedTicketIds} onChange={(event) => setManageDraft((current) => ({ ...current, relatedTicketIds: event.target.value }))} placeholder={t("supportManagement.relatedTicketIdsPlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                      {t("supportManagement.publicMessage")}
                      <textarea value={publicMessageDraft} onChange={(event) => setPublicMessageDraft(event.target.value)} rows={3} placeholder={t("supportManagement.publicMessagePlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" />
                      <span className="text-xs font-normal text-slate-500">{t("supportManagement.publicMessageHint")}</span>
                    </label>
                    <div className="border-t border-slate-200 pt-4">
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
                    </div>
                    <div className="text-xs text-slate-500">{t("supportManagement.reportingHint", { recent: summary?.recentCreatedLast7Days ?? 0, closed: summary?.closedLast7Days ?? 0, average: summary?.averageHoursToClose ?? "-" })}</div>
                    <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
                      <Button type="button" className="btn btn-primary w-full" disabled={isSaving} onClick={() => void saveRequest()}>
                        {isSaving ? t("supportManagement.actions.saving") : t("supportManagement.actions.updateRequest")}
                      </Button>
                      <div className="text-xs text-slate-500">{t("supportManagement.deleteHint")}</div>
                      {deleteConfirming ? (
                        <div className="flex gap-2">
                          <Button type="button" className="btn btn-secondary flex-1" disabled={deletePending} onClick={() => setDeleteConfirming(false)}>
                            {t("common.actions.cancel")}
                          </Button>
                          <Button type="button" className="btn btn-danger flex-1" disabled={deletePending} onClick={() => void deleteRequest()}>
                            {deletePending ? t("supportManagement.actions.deletePending") : t("supportManagement.actions.deleteConfirm")}
                          </Button>
                        </div>
                      ) : (
                        <Button type="button" className="btn btn-danger w-full" disabled={deletePending} onClick={() => setDeleteConfirming(true)}>
                          {t("supportManagement.actions.delete")}
                        </Button>
                      )}
                    </div>
                  </aside>
                </div>
              ) : null}

              {detailTab === "notes" ? (
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">{t("supportManagement.internalNotes")}</div>
                  <div className="space-y-2">
                    {detail.notes.length ? detail.notes.map((note) => (
                      <div key={note.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <div className="whitespace-pre-wrap text-slate-700">{note.body}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(note.createdAt, locale)}
                          {" | "}
                          {note.authorEmail || note.authorName || note.authorUid || "-"}
                        </div>
                      </div>
                    )) : <p className="small">{t("supportManagement.noNotes")}</p>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} rows={4} placeholder={t("supportManagement.notePlaceholder")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
                    <Button type="button" className="btn btn-secondary self-start" disabled={isAddingNote || !newNote.trim()} onClick={() => void addNote()}>
                      {isAddingNote ? t("supportManagement.actions.saving") : t("supportManagement.actions.addNote")}
                    </Button>
                  </div>
                </section>
              ) : null}

              {detailTab === "details" ? (
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.reporter")}</div>
                      <div className="mt-1 text-base font-semibold text-slate-900">{detail.request.createdByDisplayName || "-"}</div>
                      <div className="text-sm text-slate-600">{detail.request.createdByEmail || detail.request.createdByUid || "-"}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.family")}</div>
                      <div className="mt-1 text-base font-semibold text-slate-900">{detail.request.familyName || t("supportManagement.familyFallback")}</div>
                      <div className="text-sm text-slate-600">{detail.request.familyId}</div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.type")}</div><div className="mt-1">{t(`support.type.${detail.request.type}`)}</div></div>
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.severity")}</div><div className="mt-1">{detail.request.severity ? t(`support.severity.${detail.request.severity}`) : t("supportManagement.severityNone")}</div></div>
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.importance")}</div><div className="mt-1">{detail.request.importance ? t(`support.importance.${detail.request.importance}`) : t("supportManagement.severityNone")}</div></div>
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.category")}</div><div className="mt-1 text-sm">{detail.request.category ? (t(`support.categories.${detail.request.category}`) !== `support.categories.${detail.request.category}` ? t(`support.categories.${detail.request.category}`) : detail.request.category) : <span className="text-slate-400">{t("supportManagement.categoryNone")}</span>}</div></div>
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.created")}</div><div className="mt-1">{formatDateTime(detail.request.createdAt, locale)}</div></div>
                    <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.columns.updated")}</div><div className="mt-1">{formatDateTime(detail.request.updatedAt, locale)}</div></div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.preferences")}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-sm">
                      <EnumChip label={`${t("supportManagement.allowContactShort")}: ${detail.request.allowContact ? t("supportManagement.prefYes") : t("supportManagement.prefNo")}`} tone={detail.request.allowContact ? "green" : "slate"} />
                      <EnumChip label={`${t("supportManagement.notifyShort")}: ${detail.request.notifyOnStatusChange ? t("supportManagement.prefYes") : t("supportManagement.prefNo")}`} tone={detail.request.notifyOnStatusChange ? "green" : "slate"} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("supportManagement.diagnostics")}</div>
                    <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex gap-1"><dt className="text-slate-500">{t("supportManagement.diag.browser")}:</dt><dd className="text-slate-800">{detail.request.diagnostics.browser || "-"}</dd></div>
                      <div className="flex gap-1"><dt className="text-slate-500">{t("supportManagement.diag.os")}:</dt><dd className="text-slate-800">{detail.request.diagnostics.operatingSystem || "-"}</dd></div>
                      <div className="flex gap-1"><dt className="text-slate-500">{t("supportManagement.diag.screen")}:</dt><dd className="text-slate-800">{detail.request.diagnostics.screenResolution || "-"}</dd></div>
                      <div className="flex gap-1"><dt className="text-slate-500">{t("supportManagement.diag.language")}:</dt><dd className="text-slate-800">{detail.request.diagnostics.language || "-"}</dd></div>
                      <div className="flex gap-1"><dt className="text-slate-500">{t("supportManagement.diag.appVersion")}:</dt><dd className="text-slate-800">{detail.request.diagnostics.appVersion || "-"}</dd></div>
                      <div className="flex gap-1 sm:col-span-2"><dt className="text-slate-500">{t("supportManagement.diag.userAgent")}:</dt><dd className="break-all text-slate-800">{detail.request.userAgent || "-"}</dd></div>
                    </dl>
                    {detail.request.diagnostics.recentConsoleErrors ? (
                      <div className="mt-2">
                        <div className="text-xs font-semibold text-slate-500">{t("supportManagement.diag.consoleErrors")}</div>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{detail.request.diagnostics.recentConsoleErrors}</pre>
                      </div>
                    ) : null}
                    {detail.request.diagnostics.recentApiFailures ? (
                      <div className="mt-2">
                        <div className="text-xs font-semibold text-slate-500">{t("supportManagement.diag.apiFailures")}</div>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{detail.request.diagnostics.recentApiFailures}</pre>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {detailTab === "audit" ? (
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">{t("supportManagement.auditTitle")}</div>
                  <div className="space-y-2">
                    {auditTimeline.length ? auditTimeline.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-slate-900">{entry.title}</div>
                          <EnumChip label={entry.kind === "status" ? t("supportManagement.history") : t("supportManagement.activity")} tone={entry.kind === "status" ? "indigo" : "slate"} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(entry.createdAt, locale)}
                          {" | "}
                          {entry.actor}
                        </div>
                        {entry.body ? <div className="mt-1 whitespace-pre-wrap text-slate-700">{entry.body}</div> : null}
                      </div>
                    )) : <p className="small">{t("supportManagement.noAudit")}</p>}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </ModalShell>
    </SupportConsoleShell>
  );
}
