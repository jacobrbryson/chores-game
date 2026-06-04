"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { SupportCommunityAwardsPanel } from "@/components/support-community-awards-panel";
import { SupportFeedPanel } from "@/components/support-feed-panel";
import { SupportGhostChoresPanel } from "@/components/support-ghost-chores-panel";
import { SupportNewslettersPanel } from "@/components/support-newsletters-panel";
import { usePersistedTab } from "@/lib/hooks/use-persisted-tab";
import { CategorySelector } from "@/components/category-selector";
import {
  SUPPORT_REQUEST_SEVERITIES,
  type SupportRequestSeverity,
  type SupportRequestType,
} from "@/lib/support/requests";

// English labels for category keys — mirrors apps/web/packages/locales/src/en-US.json
// support.categories. Kept here because the support console has no locale provider.
const CATEGORY_LABELS: Record<string, string> = {
  feature_rewards_motivation: "Rewards & Motivation",
  feature_quests_adventures: "Quests & Adventures",
  feature_family_engagement: "Family Engagement",
  feature_personalization: "Personalization",
  feature_sharing_growth: "Sharing & Growth",
  feature_community: "Community Features",
  feature_task_management: "Task Management",
  feature_notifications: "Notifications & Reminders",
  feature_analytics: "Analytics & Reporting",
  bug_auth: "Authentication & Sign-In",
  bug_chore_tracking: "Chore Tracking & Completion",
  bug_coin_rewards: "Coin & Reward Calculation",
  bug_notifications: "Notifications & Alerts",
  bug_quests: "Quest & Adventure Issues",
  bug_store: "Store & Inventory",
  bug_family: "Family Management",
  bug_data_sync: "Data Sync & Loading",
  bug_interface: "Interface & Display",
  bug_performance: "Performance & Responsiveness",
  other: "Other",
};

type SupportUser = {
  uid: string;
  email: string;
  name: string;
  role: string;
  familyIds: string[];
  walletBalance: number;
  googleTasksLinked: boolean;
  googleTasksLastSyncStatus: string;
  googleTasksLastSyncedAt: string;
  lastSignInAt: string;
};

type SupportFamily = {
  id: string;
  name: string;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  admins: Array<{ name: string }>;
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

type SupportTab = "families" | "users" | "chores";
type MetricKey = "users" | "families" | "chores" | "auditEvents" | "notifications";

const PAGE_SIZE = 10;

const TABS: Array<{ id: SupportTab; label: string }> = [
  { id: "families", label: "Families" },
  { id: "users", label: "Users" },
  { id: "chores", label: "Chores" },
];

const SUPPORT_TAB_IDS: readonly SupportTab[] = ["families", "users", "chores"];

const METRICS: Array<{
  key: MetricKey;
  label: string;
  className: string;
}> = [
  {
    key: "families",
    label: "Families",
    className: "from-sky-500 to-cyan-500",
  },
  {
    key: "users",
    label: "Users",
    className: "from-emerald-500 to-teal-500",
  },
  {
    key: "chores",
    label: "Chores",
    className: "from-violet-500 to-fuchsia-500",
  },
  {
    key: "auditEvents",
    label: "Audit",
    className: "from-amber-500 to-orange-500",
  },
  {
    key: "notifications",
    label: "Activity",
    className: "from-rose-500 to-red-500",
  },
];

function formatDate(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function compactId(value: string) {
  if (!value) {
    return "-";
  }
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function statusClass(status: string) {
  if (status === "Approved") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }
  if (status === "Submitted") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
  if (status === "Rejected" || status === "Deleted") {
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  }
  return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
}

function containsQuery(values: string[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function paginate<T>(rows: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  return {
    rows: rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    page: safePage,
    totalPages,
  };
}

function countByRecentMonths(values: string[], monthCount = 6) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const labels = Array.from({ length: monthCount }, (_, index) => {
    const monthOffset = monthCount - 1 - index;
    const startDate = new Date(currentMonthStart);
    startDate.setMonth(startDate.getMonth() - monthOffset);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);
    return {
      label: startDate.toLocaleDateString(undefined, { month: "short" }),
      start: startDate.getTime(),
      end: endDate.getTime(),
      value: 0,
    };
  });

  for (const value of values) {
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) {
      continue;
    }
    const bucket = labels.find((entry) => millis >= entry.start && millis < entry.end);
    if (bucket) {
      bucket.value += 1;
    }
  }

  return labels.map(({ label, value }) => ({ label, value }));
}

function maxBucketValue(buckets: Array<{ value: number }>) {
  return Math.max(1, ...buckets.map((bucket) => bucket.value));
}

function rawRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rawString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4">
      <path
        d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
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
        <Button
          className="btn btn-secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button
          className="btn btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function SearchPanel({
  onSubmit,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[1fr_1fr_auto]">
      {children}
    </form>
  );
}

function SearchInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
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

type CreateRequestDraft = {
  familyId: string;
  targetUid: string;
  targetEmail: string;
  targetDisplayName: string;
  type: SupportRequestType;
  category: string;
  subject: string;
  severity: SupportRequestSeverity;
  description: string;
  internalNote: string;
};

const EMPTY_DRAFT: CreateRequestDraft = {
  familyId: "",
  targetUid: "",
  targetEmail: "",
  targetDisplayName: "",
  type: "bug",
  category: "",
  subject: "",
  severity: "medium",
  description: "",
  internalNote: "",
};

function CreateRequestModal({
  open,
  draft,
  onDraftChange,
  onClose,
  onSubmit,
  submitting,
  submitError,
}: {
  open: boolean;
  draft: CreateRequestDraft;
  onDraftChange: (patch: Partial<CreateRequestDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string;
}) {
  const isBug = draft.type === "bug";

  return (
    <ModalShell open={open} onRequestClose={onClose}>
      <div className="family-modal-card w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="modal-dialog-title-row family-modal-title-row mb-4">
          <h2 className="family-modal-title">Create Request on Behalf of User</h2>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Close">
            ✕
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Target user */}
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Target User
            </legend>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                <span>Family ID <span className="font-normal text-rose-600">*</span></span>
                <input
                  value={draft.familyId}
                  onChange={(e) => onDraftChange({ familyId: e.target.value })}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  placeholder="Paste family ID from console"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  <span>User UID <span className="font-normal text-rose-600">*</span></span>
                  <input
                    value={draft.targetUid}
                    onChange={(e) => onDraftChange({ targetUid: e.target.value })}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    placeholder="User UID"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  Email
                  <input
                    value={draft.targetEmail}
                    onChange={(e) => onDraftChange({ targetEmail: e.target.value })}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    placeholder="user@example.com"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Display Name
                <input
                  value={draft.targetDisplayName}
                  onChange={(e) => onDraftChange({ targetDisplayName: e.target.value })}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  placeholder="User's display name"
                />
              </label>
            </div>
          </fieldset>

          {/* Request type */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              <span>Type <span className="font-normal text-rose-600">*</span></span>
              <select
                value={draft.type}
                onChange={(e) => onDraftChange({ type: e.target.value as SupportRequestType, category: "", severity: "medium" })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Category
              <CategorySelector
                type={draft.type}
                value={draft.category}
                onChange={(val) => onDraftChange({ category: val })}
                labelFor={(key) => CATEGORY_LABELS[key] ?? key}
                selectClassName="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                inputClassName="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                placeholder="— Select a category —"
                customPlaceholder="Enter a custom category…"
                customLabel="Custom category"
              />
            </div>
          </div>

          {isBug ? (
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              <span>Severity <span className="font-normal text-rose-600">*</span></span>
              <select
                value={draft.severity}
                onChange={(e) => onDraftChange({ severity: e.target.value as SupportRequestSeverity })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
                {SUPPORT_REQUEST_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            <span>Subject <span className="font-normal text-rose-600">*</span></span>
            <input
              value={draft.subject}
              onChange={(e) => onDraftChange({ subject: e.target.value })}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
              placeholder="A short summary"
              maxLength={150}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            <span>Description <span className="font-normal text-rose-600">*</span></span>
            <textarea
              value={draft.description}
              onChange={(e) => onDraftChange({ description: e.target.value })}
              rows={4}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
              placeholder="Full description of the bug or feature request"
              maxLength={4000}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Internal Note
            <textarea
              value={draft.internalNote}
              onChange={(e) => onDraftChange({ internalNote: e.target.value })}
              rows={2}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
              placeholder="Why was this created on behalf of the user? (admin-only, not shown to user)"
              maxLength={2000}
            />
          </label>

          {submitError ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" className="btn btn-secondary" disabled={submitting} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" className="btn btn-primary" disabled={submitting} onClick={onSubmit}>
              {submitting ? "Creating…" : "Create Request"}
            </Button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export default function SupportPageClient() {
  const [activeTab, setActiveTab] = usePersistedTab<SupportTab>({
    storageKey: "support-page-active-tab",
    defaultTab: "families",
    validTabs: SUPPORT_TAB_IDS,
  });
  const [familyQuery, setFamilyQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [choreQuery, setChoreQuery] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [userId, setUserId] = useState("");
  const [choreId, setChoreId] = useState("");
  const [familiesPage, setFamiliesPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  const [choresPage, setChoresPage] = useState(1);
  const [expandedMetric, setExpandedMetric] = useState<MetricKey | "">("");
  const [payload, setPayload] = useState<SupportPayload | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SupportEvent | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    entity: "family" | "user" | "chore";
    id: string;
    label: string;
    familyId?: string;
  } | null>(null);
  const [createRequestOpen, setCreateRequestOpen] = useState(false);
  const [createRequestDraft, setCreateRequestDraft] = useState<CreateRequestDraft>(EMPTY_DRAFT);
  const [createRequestSubmitting, setCreateRequestSubmitting] = useState(false);
  const [createRequestError, setCreateRequestError] = useState("");
  const [createRequestNotice, setCreateRequestNotice] = useState("");

  const loadSupportData = useCallback(async () => {
    const params = new URLSearchParams();
    if (familyId.trim()) {
      params.set("familyId", familyId.trim());
    }
    if (userId.trim()) {
      params.set("userId", userId.trim());
    }
    if (choreId.trim()) {
      params.set("choreId", choreId.trim());
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/support/debug?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as SupportPayload & { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Support data unavailable");
      }
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Support data unavailable");
    } finally {
      setLoading(false);
    }
  }, [choreId, familyId, userId]);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  const filteredFamilies = useMemo(
    () =>
      (payload?.families ?? []).filter((family) =>
        containsQuery([family.id, family.name, family.createdBy], familyQuery),
      ),
    [familyQuery, payload?.families],
  );
  const filteredUsers = useMemo(
    () =>
      (payload?.users ?? []).filter((user) =>
        containsQuery(
          [user.uid, user.email, user.name, user.role, user.familyIds.join(" ")],
          userQuery,
        ),
      ),
    [payload?.users, userQuery],
  );
  const filteredChores = useMemo(
    () =>
      (payload?.chores ?? []).filter((chore) =>
        containsQuery(
          [
            chore.id,
            chore.familyId,
            chore.title,
            chore.status,
            chore.assigneeId,
            chore.assigneeName,
            chore.source,
            chore.googleTaskOwnerUid,
          ],
          choreQuery,
        ),
      ),
    [choreQuery, payload?.chores],
  );

  const familiesPageData = useMemo(
    () => paginate(filteredFamilies, familiesPage),
    [familiesPage, filteredFamilies],
  );
  const usersPageData = useMemo(
    () => paginate(filteredUsers, usersPage),
    [filteredUsers, usersPage],
  );
  const choresPageData = useMemo(
    () => paginate(filteredChores, choresPage),
    [choresPage, filteredChores],
  );
  const selectedChore = useMemo(
    () => payload?.chores.find((chore) => chore.id === choreId) ?? payload?.chores[0],
    [choreId, payload?.chores],
  );
  const selectedMetric = useMemo(
    () => METRICS.find((metric) => metric.key === expandedMetric),
    [expandedMetric],
  );
  const metricBuckets = useMemo(() => {
    if (!payload || !expandedMetric) {
      return [];
    }
    if (expandedMetric === "families") {
      return countByRecentMonths(payload.families.map((family) => family.createdAt));
    }
    if (expandedMetric === "users") {
      return countByRecentMonths(payload.users.map((user) => user.lastSignInAt));
    }
    if (expandedMetric === "chores") {
      return countByRecentMonths(payload.chores.map((chore) => chore.updatedAt || chore.submittedAt || chore.createdAt));
    }
    if (expandedMetric === "auditEvents") {
      return countByRecentMonths(
        payload.events
          .filter((event) => event.kind === "audit")
          .map((event) => event.createdAt),
      );
    }
    return countByRecentMonths(
      payload.events
        .filter((event) => event.kind === "notification")
        .map((event) => event.createdAt),
    );
  }, [expandedMetric, payload]);
  const choreTimeline = useMemo(() => {
    if (!payload || !selectedChore) {
      return [];
    }
    return payload.events
      .filter((event) => event.choreId === selectedChore.id)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }, [payload, selectedChore]);
  const choreLedger = useMemo(() => {
    if (!payload || !selectedChore) {
      return [];
    }
    return payload.ledgers
      .filter((entry) => entry.choreId === selectedChore.id)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }, [payload, selectedChore]);
  const investigation = useMemo(() => {
    if (!selectedChore) {
      return null;
    }
    const latestAudit = choreTimeline.find((event) => event.kind === "audit");
    const latestAuditRaw = rawRecord(latestAudit?.raw);
    const previous = rawRecord(latestAuditRaw.previous);
    const next = rawRecord(latestAuditRaw.next);
    const reason = rawString(latestAuditRaw, "reason") || latestAudit?.reason || latestAudit?.eventType || "";
    const previousStatus = rawString(previous, "status");
    const nextStatus = rawString(next, "status");
    const hasApprovalEvidence = choreTimeline.some(
      (event) => event.eventType === "chore_approved" || event.title === "Chore approved",
    );
    const hasPayoutEvidence = choreLedger.some(
      (entry) => entry.reason === "chore_complete" && entry.delta > 0,
    );

    if (previousStatus === "Approved" && nextStatus === "Submitted") {
      return {
        tone: "warning" as const,
        title: "Audit shows Approved changed back to Submitted.",
        detail: reason
          ? `The recorded reason is ${reason}.`
          : "Open the latest audit event below for actor and field details.",
      };
    }
    if (selectedChore.status === "Submitted" && selectedChore.source === "google_tasks") {
      return {
        tone: "warning" as const,
        title: "This is a Google Tasks-synced chore currently awaiting approval.",
        detail:
          "If it was approved before this audit system existed, look for an earlier Chore approved notification or a positive chore_complete wallet ledger row. The sync bug fixed here could previously downgrade Approved chores to Submitted.",
      };
    }
    if (selectedChore.status === "Submitted" && (hasApprovalEvidence || hasPayoutEvidence)) {
      return {
        tone: "warning" as const,
        title: "This chore has approval or payout evidence but is currently Submitted.",
        detail:
          "Use the timeline and wallet ledger below to compare the approval/payout time against the latest update time.",
      };
    }
    return {
      tone: "info" as const,
      title: "No approved-to-submitted transition is visible in the loaded audit data.",
      detail:
        "For older incidents, audit logs may not exist yet. Check activity notifications and wallet ledger rows for historical approval evidence.",
    };
  }, [choreLedger, choreTimeline, selectedChore]);

  function openCreateRequest(user?: SupportUser) {
    setCreateRequestError("");
    setCreateRequestNotice("");
    setCreateRequestDraft(
      user
        ? {
            ...EMPTY_DRAFT,
            familyId: user.familyIds[0] ?? "",
            targetUid: user.uid,
            targetEmail: user.email,
            targetDisplayName: user.name,
          }
        : EMPTY_DRAFT,
    );
    setCreateRequestOpen(true);
  }

  async function submitCreateRequest() {
    if (createRequestSubmitting) return;
    setCreateRequestError("");
    setCreateRequestSubmitting(true);
    try {
      const response = await fetch("/api/support/requests/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId: createRequestDraft.familyId.trim(),
          targetUid: createRequestDraft.targetUid.trim(),
          targetEmail: createRequestDraft.targetEmail.trim(),
          targetDisplayName: createRequestDraft.targetDisplayName.trim(),
          type: createRequestDraft.type,
          subject: createRequestDraft.subject.trim(),
          description: createRequestDraft.description.trim(),
          severity: createRequestDraft.type === "bug" ? createRequestDraft.severity : undefined,
          category: createRequestDraft.category || undefined,
          internalNote: createRequestDraft.internalNote.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        supportRequest?: { id: string };
      };
      if (!response.ok) {
        throw new Error(data.error ?? "create_support_request_failed");
      }
      setCreateRequestOpen(false);
      setCreateRequestNotice(
        `Request created (ID: ${data.supportRequest?.id ?? "—"}). View it in Bug Reports & Feature Requests.`,
      );
    } catch (err) {
      setCreateRequestError(err instanceof Error ? err.message : "create_support_request_failed");
    } finally {
      setCreateRequestSubmitting(false);
    }
  }

  function deleteEntity(
    entity: "family" | "user" | "chore",
    id: string,
    label: string,
    familyId?: string,
  ) {
    setPendingDelete({ entity, id, label, familyId });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { entity, id, familyId } = pendingDelete;
    setPendingDelete(null);
    setDeleting(id);
    setError("");
    try {
      const response = await fetch("/api/support/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id, familyId }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Delete failed");
      }
      setPayload((prev) => {
        if (!prev) return prev;
        if (entity === "family") {
          return { ...prev, families: prev.families.filter((f) => f.id !== id) };
        }
        if (entity === "user") {
          return { ...prev, users: prev.users.filter((u) => u.uid !== id) };
        }
        return {
          ...prev,
          chores: prev.chores.map((c) =>
            c.id === id && c.familyId === familyId ? { ...c, status: "Deleted" } : c,
          ),
        };
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  function inspectChore(chore: SupportChore) {
    setFamilyId(chore.familyId);
    setUserId(chore.assigneeId || chore.googleTaskOwnerUid);
    setChoreId(chore.id);
    setActiveTab("chores");
  }

  function clearScope() {
    setFamilyId("");
    setUserId("");
    setChoreId("");
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Support Console</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="btn btn-primary"
            onClick={() => openCreateRequest()}>
            Create Request on Behalf
          </Button>
          <Link href="/support/requests" className="btn btn-secondary">
            Bug Reports & Feature Requests
          </Link>
        </div>
      </div>
      {createRequestNotice ? (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {createRequestNotice}
          <Button
            type="button"
            className="ml-3 text-xs underline"
            onClick={() => setCreateRequestNotice("")}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <SupportCommunityAwardsPanel />
      <SupportGhostChoresPanel />
      <SupportNewslettersPanel />
      {payload ? <SupportFeedPanel events={payload.events} /> : null}
      {payload ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 min-[560px]:flex-row min-[560px]:flex-nowrap">
            {METRICS.map((metric) => {
              const value = payload.counts[metric.key] ?? 0;
              const isExpanded = expandedMetric === metric.key;
              return (
                <button
                  key={metric.key}
                  className={`group relative overflow-hidden rounded-lg bg-gradient-to-br ${metric.className} p-4 text-left text-white shadow-sm ring-offset-2 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-800 min-[560px]:min-w-0 min-[560px]:flex-1 ${isExpanded ? "ring-2 ring-slate-800" : ""}`}
                  onClick={() => setExpandedMetric(isExpanded ? "" : metric.key)}>
                  <span className="absolute right-3 top-3 opacity-0 transition group-hover:opacity-90">
                    <ExpandIcon />
                  </span>
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/80">
                    {metric.label}
                  </div>
                  <div className="mt-1 text-2xl font-bold">{value}</div>
                </button>
              );
            })}
          </div>
          {selectedMetric ? (
            <div className={`rounded-lg bg-gradient-to-br ${selectedMetric.className} p-4 text-white shadow-sm`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/80">
                    {selectedMetric.label} trend
                  </div>
                  <div className="text-xs text-white/75">Real counts from the loaded support dataset by month.</div>
                </div>
                <Button
                  className="rounded-md bg-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/30"
                  onClick={() => setExpandedMetric("")}>
                  Collapse
                </Button>
              </div>
              <div className="mt-4 flex h-28 items-end gap-3">
                {metricBuckets.map((bucket) => {
                  const height = Math.max(10, Math.round((bucket.value / maxBucketValue(metricBuckets)) * 100));
                  return (
                    <div key={bucket.label} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-20 w-full items-end">
                        <div
                          className="w-full rounded-t bg-white/80"
                          title={`${bucket.label}: ${bucket.value}`}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <div className="text-xs font-semibold text-white/85">{bucket.label}</div>
                      <div className="text-xs text-white/75">{bucket.value}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {payload?.suspicious.length ? (
        <Alert tone="warning">
          {payload.suspicious.length} submitted chore(s) have approval or payout evidence.
          These are the best candidates for the reported approved-to-awaiting-approval issue.
        </Alert>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 pt-3">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <Button
                key={tab.id}
                className={`rounded-t-md border px-4 py-2 text-sm font-semibold ${
                  activeTab === tab.id
                    ? "border-slate-300 border-b-white bg-white text-slate-900"
                    : "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="pb-3 text-sm text-slate-500">
            Showing up to {payload?.counts.maxResultRows ?? 100} records per dataset
          </div>
        </div>

        {activeTab === "families" ? (
          <>
            <SearchPanel
              onSubmit={(event) => {
                event.preventDefault();
                setFamiliesPage(1);
              }}>
              <SearchInput
                label="Search families"
                value={familyQuery}
                onChange={setFamilyQuery}
                placeholder="Family name, ID, creator"
              />
              <SearchInput label="Scope to family ID" value={familyId} onChange={setFamilyId} />
              <div className="flex items-end gap-2">
                <Button type="submit" className="btn btn-primary" disabled={loading}>
                  Filter
                </Button>
                <Button className="btn btn-secondary" onClick={clearScope}>
                  Clear scope
                </Button>
              </div>
            </SearchPanel>
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">Created By</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {familiesPageData.rows.map((family) => (
                    <tr
                      key={family.id}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setFamilyId(family.id)}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{family.name}</div>
                        {family.admins.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {family.admins.map((admin) => (
                              <span
                                key={admin.name}
                                className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                                {admin.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{family.createdByEmail || compactId(family.createdBy)}</td>
                      <td className="px-3 py-2">{formatDate(family.createdAt)}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          className="btn btn-danger"
                          disabled={deleting === family.id}
                          onClick={() => void deleteEntity("family", family.id, family.name)}>
                          {deleting === family.id ? "Deleting…" : "Delete"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={familiesPageData.page}
              totalPages={familiesPageData.totalPages}
              total={filteredFamilies.length}
              onPageChange={setFamiliesPage}
            />
          </>
        ) : null}

        {activeTab === "users" ? (
          <>
            <SearchPanel
              onSubmit={(event) => {
                event.preventDefault();
                setUsersPage(1);
              }}>
              <SearchInput
                label="Search users"
                value={userQuery}
                onChange={setUserQuery}
                placeholder="Email, name, UID, role"
              />
              <SearchInput label="Scope to user ID" value={userId} onChange={setUserId} />
              <div className="flex items-end gap-2">
                <Button type="submit" className="btn btn-primary" disabled={loading}>
                  Filter
                </Button>
                <Button className="btn btn-secondary" onClick={clearScope}>
                  Clear scope
                </Button>
              </div>
            </SearchPanel>
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Coins</th>
                    <th className="px-3 py-2">Tasks</th>
                    <th className="px-3 py-2">Last Sign In</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersPageData.rows.map((user) => (
                    <tr
                      key={user.uid}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setUserId(user.uid)}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">
                          {user.name || user.email || user.uid}
                        </div>
                        <div className="text-xs text-slate-500">{user.email || "-"}</div>
                      </td>
                      <td className="px-3 py-2">{user.role}</td>
                      <td className="px-3 py-2">{user.walletBalance}</td>
                      <td className="px-3 py-2">{user.googleTasksLinked ? "Linked" : "-"}</td>
                      <td className="px-3 py-2">{formatDate(user.lastSignInAt)}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <Button
                            className="btn btn-secondary"
                            onClick={() => openCreateRequest(user)}>
                            Create Request
                          </Button>
                          <Button
                            className="btn btn-danger"
                            disabled={deleting === user.uid}
                            onClick={() => void deleteEntity("user", user.uid, user.name || user.email || user.uid)}>
                            {deleting === user.uid ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={usersPageData.page}
              totalPages={usersPageData.totalPages}
              total={filteredUsers.length}
              onPageChange={setUsersPage}
            />
          </>
        ) : null}

        {activeTab === "chores" ? (
          <>
            <SearchPanel
              onSubmit={(event) => {
                event.preventDefault();
                setChoresPage(1);
              }}>
              <SearchInput
                label="Search chores"
                value={choreQuery}
                onChange={setChoreQuery}
                placeholder="Title, status, assignee, source"
              />
              <SearchInput label="Scope to chore ID" value={choreId} onChange={setChoreId} />
              <div className="flex items-end gap-2">
                <Button type="submit" className="btn btn-primary" disabled={loading}>
                  Filter
                </Button>
                <Button className="btn btn-secondary" onClick={clearScope}>
                  Clear scope
                </Button>
              </div>
            </SearchPanel>
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Chore</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Assignee</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Submitted</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {choresPageData.rows.map((chore) => (
                    <tr key={`${chore.familyId}-${chore.id}`} className="border-t border-slate-100">
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
                      <td className="px-3 py-2">{chore.source}</td>
                      <td className="px-3 py-2">{formatDate(chore.submittedAt)}</td>
                      <td className="px-3 py-2">{formatDate(chore.updatedAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <Button className="btn btn-secondary" onClick={() => inspectChore(chore)}>
                            Inspect
                          </Button>
                          <Button
                            className="btn btn-danger"
                            disabled={deleting === chore.id || chore.status === "Deleted"}
                            onClick={() => void deleteEntity("chore", chore.id, chore.title, chore.familyId)}>
                            {deleting === chore.id ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={choresPageData.page}
              totalPages={choresPageData.totalPages}
              total={filteredChores.length}
              onPageChange={setChoresPage}
            />
          </>
        ) : null}
      </section>

      {payload ? (
        <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold text-slate-900">Wallet Ledger</h2>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Delta</th>
                    <th className="px-3 py-2">Balance</th>
                    <th className="px-3 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.ledgers.map((entry) => (
                    <tr key={`${entry.uid}-${entry.id}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{entry.reason}</div>
                        <div className="text-xs text-slate-500">{compactId(entry.choreId || entry.itemId)}</div>
                      </td>
                      <td className="px-3 py-2">{entry.delta}</td>
                      <td className="px-3 py-2">{entry.balanceAfter}</td>
                      <td className="px-3 py-2">{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold text-slate-900">Event Timeline</h2>
            </div>
            <div className="max-h-80 overflow-auto">
              {payload.events.map((event) => (
                <button
                  key={`${event.kind}-${event.id}`}
                  className="block w-full border-t border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => setSelectedEvent(event)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      {event.kind}
                    </span>
                    <span className="font-semibold text-slate-900">
                      {event.eventType || event.title || "event"}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(event.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {event.message || event.reason || event.choreTitle || event.choreId}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {selectedChore ? (
        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Why Is This Chore Awaiting Approval?</h2>
            {investigation ? (
              <Alert tone={investigation.tone} role="status" className="mt-3">
                <strong>{investigation.title}</strong>
                <br />
                {investigation.detail}
              </Alert>
            ) : null}
            <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Current status</div>
                <div className="mt-1">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(selectedChore.status)}`}>
                    {selectedChore.status}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Source</div>
                <div className="mt-1 font-semibold text-slate-900">{selectedChore.source}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Updated</div>
                <div className="mt-1">{formatDate(selectedChore.updatedAt)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">Submitted</div>
                <div className="mt-1">{formatDate(selectedChore.submittedAt)}</div>
              </div>
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold text-slate-900">Chore Timeline</h3>
              <div className="mt-2 max-h-72 overflow-auto rounded-md border border-slate-200">
                {choreTimeline.length > 0 ? (
                  choreTimeline.map((event) => (
                    <button
                      key={`${event.kind}-${event.id}`}
                      className="block w-full border-t border-slate-100 px-3 py-2 text-left first:border-t-0 hover:bg-slate-50"
                      onClick={() => setSelectedEvent(event)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {event.kind}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">
                          {event.eventType || event.title || "event"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {event.reason || event.message || event.choreTitle || event.choreId}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-sm text-slate-500">
                    No audit/activity events are loaded for this chore.
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold text-slate-900">Related Wallet Ledger</h3>
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-200">
                {choreLedger.length > 0 ? (
                  choreLedger.map((entry) => (
                    <div key={`${entry.uid}-${entry.id}`} className="border-t border-slate-100 px-3 py-2 first:border-t-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-slate-900">{entry.reason}</span>
                        <span className={entry.delta >= 0 ? "text-emerald-700" : "text-red-700"}>
                          {entry.delta >= 0 ? "+" : ""}
                          {entry.delta}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatDate(entry.createdAt)} / balance {entry.balanceAfter}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-sm text-slate-500">
                    No wallet ledger rows are loaded for this chore.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Current Chore Snapshot</h2>
            <pre className="mt-3 max-h-[38rem] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(selectedChore, null, 2)}
            </pre>
          </div>
        </section>
      ) : null}

      {selectedEvent ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Selected Event</h2>
            <Button className="btn btn-secondary" onClick={() => setSelectedEvent(null)}>
              Close
            </Button>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
            {JSON.stringify(selectedEvent.raw, null, 2)}
          </pre>
        </section>
      ) : null}
      <CreateRequestModal
        open={createRequestOpen}
        draft={createRequestDraft}
        onDraftChange={(patch) => setCreateRequestDraft((prev) => ({ ...prev, ...patch }))}
        onClose={() => setCreateRequestOpen(false)}
        onSubmit={() => void submitCreateRequest()}
        submitting={createRequestSubmitting}
        submitError={createRequestError}
      />

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
                  ✕
                </Button>
              </div>
              <p className="mb-5 text-sm text-slate-600">
                Are you sure you want to permanently delete{" "}
                <strong className="text-slate-900">{pendingDelete.label}</strong>? This cannot be
                undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingDelete(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete()}>
                  Delete
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </main>
  );
}
