"use client";

import { AddEditChoresDialog, FAMILY_ASSIGNEE_OPTION_ID, type AddEditChoreSavedResult } from "@/components/add-edit-chores-dialog";
import { GhostChoreEmptyStateSuggestions } from "@/components/ghost-chore-suggestions";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { useLocale } from "@/components/locale-provider";
import { MenuActionButton } from "@/components/menu-action-button";
import { MenuActionLink } from "@/components/menu-action-link";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  CategoryScale,
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  type Plugin,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import Link from "next/link";
import { TodayChoreCard } from "@/components/today-chore-card";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  createApprovalAssigneeSelections,
  listApprovalPayouts,
  toggleApprovalAssigneeSelection,
  updateApprovalAssigneeCoins,
  type ApprovalAssigneeSelectionMap,
} from "@packages/core";
import { getDashboardChorePage } from "@/lib/ui/chore-dashboard";
import type { FamilySnapshotChore, FamilySnapshotMember } from "@/lib/family/types";
import {
  parseCompletionWindow,
  type CompletionWindow,
} from "@/lib/preferences/completion-window";
import { triggerPartyConfetti } from "@/lib/confetti/party";
import { markDiscoverySeen } from "@/lib/hooks/use-discovery";
import type { ChoreType } from "@/lib/chores/types";

type TodayChoresPanelProps = {
  chores: FamilySnapshotChore[];
  members: FamilySnapshotMember[];
  viewerAssigneeIds: string[];
  viewerRole: "admin" | "player";
  onReload: () => Promise<void> | void;
  completionStatsReloadKey?: number;
};

type CompletionTrendInterval = "hour" | "day" | "week";

type CompletionCount = {
  memberId: string;
  name: string;
  count: number;
  color?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
};

type CompletionSeriesMember = {
  memberId: string;
  name: string;
  points: number[];
  color?: string;
};

type CompletionSeries = {
  interval: CompletionTrendInterval;
  labels: string[];
  maxCount: number;
  series: CompletionSeriesMember[];
};

type QuickSortKey = "coin_value" | "frequency" | "alphabetical";
type QuickSortDirection = "asc" | "desc";

type QuickSortState = {
  key: QuickSortKey;
  direction: QuickSortDirection;
};

type ChoreScopeSelection = "family" | `member:${string}`;
type ToolbarMenuView = "root" | "sort";
type ChoreFilterSection = "category" | "type" | "dueDate";
type DashboardChoreFilterState = {
  categoryIds: string[];
  choreTypes: ChoreType[];
  dueFrom: string;
  dueTo: string;
};

type CompletionStatsResponse = {
  window: CompletionWindow;
  counts: CompletionCount[];
  trend?: CompletionSeries;
};

function getSafeHexColor(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

function normalizeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function normalizeAssigneeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function getMemberAliasSet(member: FamilySnapshotMember) {
  return new Set(
    [member.id, member.uid, member.email]
      .map((value) => normalizeAssigneeAlias(value))
      .filter(Boolean),
  );
}

function choreMatchesMember(chore: FamilySnapshotChore, member: FamilySnapshotMember) {
  if (chore.assigneeScope === "family") {
    return true;
  }
  const memberAliases = getMemberAliasSet(member);
  return (
    (chore.assigneeIds ?? []).some((id) => memberAliases.has(normalizeAssigneeAlias(id))) ||
    Boolean(chore.assigneeId && memberAliases.has(normalizeAssigneeAlias(chore.assigneeId)))
  );
}

function getApprovalAssigneeIds(chore: FamilySnapshotChore, members: FamilySnapshotMember[]) {
  if (chore.assigneeScope === "family") {
    return members.filter((member) => member.status === "active").map((member) => member.id);
  }
  if (chore.assigneeIds && chore.assigneeIds.length > 0) {
    return chore.assigneeIds;
  }
  return chore.assigneeId ? [chore.assigneeId] : [];
}

function normalizeChoreTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatCompactBalance(value: number) {
  if (value < 1000) {
    return `${value}`;
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (value < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  return `${(value / 1_000_000_000).toFixed(1)}b`;
}

const CHORE_SCOPE_STORAGE_KEY = "today_chores_scope";
const COMPLETION_WINDOW_STORAGE_KEY = "today_chores_completion_window";
const QUICK_SORT_STORAGE_KEY = "today_chores_quick_sort";
const CHORE_FILTERS_STORAGE_KEY = "today_chores_filters";
const FAMILY_CHORE_SCOPE_SELECTION: ChoreScopeSelection = "family";
const EMPTY_COMPLETION_SERIES: CompletionSeries = {
  interval: "day",
  labels: [],
  maxCount: 0,
  series: [],
};
const COMPLETION_LINE_COLORS = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#332288",
  "#aa4499",
  "#d55e00",
  "#cc6677",
  "#117733",
  "#999933",
];
const CHORE_EXIT_ANIMATION_MS = 160;
const QUICK_SORT_DEFAULT_DIRECTION: Record<QuickSortKey, QuickSortDirection> = {
  coin_value: "desc",
  frequency: "desc",
  alphabetical: "asc",
};
const QUICK_SORT_KEYS: QuickSortKey[] = ["coin_value", "frequency", "alphabetical"];
const QUICK_SORT_DIRECTIONS: QuickSortDirection[] = ["asc", "desc"];
const CHORE_PAGE_SIZE = 100;
const DASHBOARD_CHORE_TYPES: ChoreType[] = ["see_and_do", "group", "normal"];
const EMPTY_DASHBOARD_CHORE_FILTERS: DashboardChoreFilterState = {
  categoryIds: [],
  choreTypes: [],
  dueFrom: "",
  dueTo: "",
};

function isIsoDateInput(value: unknown): value is string {
  return typeof value === "string" && (/^\d{4}-\d{2}-\d{2}$/.test(value) || value === "");
}

function normalizeStoredStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function dashboardChoreFiltersAreEmpty(filters: DashboardChoreFilterState) {
  return (
    filters.categoryIds.length === 0 &&
    filters.choreTypes.length === 0 &&
    !filters.dueFrom &&
    !filters.dueTo
  );
}


ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

function readChoreScopeSelection(): ChoreScopeSelection | null {
  try {
    const value = window.localStorage.getItem(CHORE_SCOPE_STORAGE_KEY);
    if (value === FAMILY_CHORE_SCOPE_SELECTION || value?.startsWith("member:")) {
      return value as ChoreScopeSelection;
    }
  } catch {
    // Ignore storage errors.
  }
  return null;
}

function writeChoreScopeSelection(next: ChoreScopeSelection) {
  try {
    window.localStorage.setItem(CHORE_SCOPE_STORAGE_KEY, next);
  } catch {
    // Ignore storage errors.
  }
}

function readCompletionWindow(): CompletionWindow {
  try {
    const value = parseCompletionWindow(window.localStorage.getItem(COMPLETION_WINDOW_STORAGE_KEY));
    if (value) {
      return value;
    }
  } catch {
    // Ignore storage errors.
  }
  return "today";
}

function ToolbarOptionsIcon() {
  return (
    <span className="today-chores-toolbar-icon" aria-hidden="true">
      <span className="today-chores-toolbar-icon-bar today-chores-toolbar-icon-bar-a" />
      <span className="today-chores-toolbar-icon-bar today-chores-toolbar-icon-bar-b" />
      <span className="today-chores-toolbar-icon-bar today-chores-toolbar-icon-bar-c" />
    </span>
  );
}

function SortMenuIcon() {
  return (
    <span className="today-chores-sort-icon" aria-hidden="true">
      <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-a" />
      <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-b" />
      <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-c" />
    </span>
  );
}

function FilterMenuIcon() {
  return (
    <span className="today-chores-filter-icon" aria-hidden="true">
      <span className="today-chores-filter-icon-line today-chores-filter-icon-line-a" />
      <span className="today-chores-filter-icon-line today-chores-filter-icon-line-b" />
      <span className="today-chores-filter-icon-line today-chores-filter-icon-line-c" />
    </span>
  );
}

function FilterSectionCaret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`today-chores-filter-section-caret${open ? " is-open" : ""}`}>
      <path
        d="M5 7.5L10 12.5L15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ViewAllChoresIcon() {
  return (
    <span className="today-chores-table-icon" aria-hidden="true">
      <span className="today-chores-table-icon-column today-chores-table-icon-column-a" />
      <span className="today-chores-table-icon-column today-chores-table-icon-column-b" />
      <span className="today-chores-table-icon-column today-chores-table-icon-column-c" />
      <span className="today-chores-table-icon-row today-chores-table-icon-row-a" />
      <span className="today-chores-table-icon-row today-chores-table-icon-row-b" />
    </span>
  );
}

function BackMenuIcon() {
  return (
    <span className="today-chores-back-icon" aria-hidden="true">
      <span className="today-chores-back-icon-shaft" />
      <span className="today-chores-back-icon-wing today-chores-back-icon-wing-top" />
      <span className="today-chores-back-icon-wing today-chores-back-icon-wing-bottom" />
    </span>
  );
}

function AddMenuIcon() {
  return (
    <span className="today-chores-add-icon" aria-hidden="true">
      <span className="today-chores-add-icon-stroke today-chores-add-icon-stroke-h" />
      <span className="today-chores-add-icon-stroke today-chores-add-icon-stroke-v" />
    </span>
  );
}

function writeCompletionWindow(next: CompletionWindow) {
  try {
    window.localStorage.setItem(COMPLETION_WINDOW_STORAGE_KEY, next);
  } catch {
    // Ignore storage errors.
  }
}

function readQuickSortState(): QuickSortState | null {
  try {
    const raw = window.localStorage.getItem(QUICK_SORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      key?: unknown;
      direction?: unknown;
    };
    if (
      typeof parsed.key === "string" &&
      QUICK_SORT_KEYS.includes(parsed.key as QuickSortKey) &&
      typeof parsed.direction === "string" &&
      QUICK_SORT_DIRECTIONS.includes(parsed.direction as QuickSortDirection)
    ) {
      return {
        key: parsed.key as QuickSortKey,
        direction: parsed.direction as QuickSortDirection,
      };
    }
  } catch {
    // Ignore storage/parse errors.
  }
  return null;
}

function writeQuickSortState(next: QuickSortState | null) {
  try {
    if (!next) {
      window.localStorage.removeItem(QUICK_SORT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(QUICK_SORT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors.
  }
}

function readDashboardChoreFilters(): DashboardChoreFilterState {
  try {
    const raw = window.localStorage.getItem(CHORE_FILTERS_STORAGE_KEY);
    if (!raw) {
      return EMPTY_DASHBOARD_CHORE_FILTERS;
    }
    const parsed = JSON.parse(raw) as {
      categoryIds?: unknown;
      choreTypes?: unknown;
      dueFrom?: unknown;
      dueTo?: unknown;
    };
    const categoryIds = normalizeStoredStringArray(parsed.categoryIds);
    const choreTypes = normalizeStoredStringArray(parsed.choreTypes).filter((entry) =>
      DASHBOARD_CHORE_TYPES.includes(entry as ChoreType),
    ) as ChoreType[];
    const dueFrom = isIsoDateInput(parsed.dueFrom) ? parsed.dueFrom : "";
    const dueTo = isIsoDateInput(parsed.dueTo) ? parsed.dueTo : "";
    return {
      categoryIds,
      choreTypes,
      dueFrom,
      dueTo,
    };
  } catch {
    // Ignore storage/parse errors.
  }
  return EMPTY_DASHBOARD_CHORE_FILTERS;
}

function writeDashboardChoreFilters(next: DashboardChoreFilterState) {
  try {
    if (dashboardChoreFiltersAreEmpty(next)) {
      window.localStorage.removeItem(CHORE_FILTERS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CHORE_FILTERS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors.
  }
}

function formatCompletionBucketLabel(value: string, window: CompletionWindow) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  const date = new Date(parsed);
  if (window === "today") {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      hour12: true,
    });
  }
  if (window === "week") {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatFilterDate(value: string) {
  if (!isIsoDate(value)) {
    return value;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function compareChoresBySortOrderOrOldest(a: FamilySnapshotChore, b: FamilySnapshotChore) {
  const aHasSortOrder = typeof a.sortOrder === "number";
  const bHasSortOrder = typeof b.sortOrder === "number";
  const aSortOrder = aHasSortOrder ? (a.sortOrder as number) : -1;
  const bSortOrder = bHasSortOrder ? (b.sortOrder as number) : -1;
  if (aHasSortOrder && bHasSortOrder && aSortOrder !== bSortOrder) {
    return aSortOrder - bSortOrder;
  }
  if (aHasSortOrder && !bHasSortOrder) {
    return -1;
  }
  if (!aHasSortOrder && bHasSortOrder) {
    return 1;
  }
  const createdDiff = toUnixMillis(a.createdAt) - toUnixMillis(b.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return a.id.localeCompare(b.id);
}

function reorderChoreIds(
  ids: string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
) {
  if (sourceId === targetId) {
    return ids;
  }
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) {
    return ids;
  }
  const nextIds = [...ids];
  nextIds.splice(sourceIndex, 1);
  const targetIndex = nextIds.indexOf(targetId);
  if (targetIndex < 0) {
    return ids;
  }
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  nextIds.splice(insertIndex, 0, sourceId);
  return nextIds;
}

export function TodayChoresPanel({
  chores,
  members,
  viewerAssigneeIds,
  viewerRole,
  onReload,
  completionStatsReloadKey = 0,
}: TodayChoresPanelProps) {
  const { t } = useLocale();
  const canCreateChores = viewerRole === "admin" || viewerRole === "player";
  const playerSeeAndDoMode = viewerRole === "player";
  const completionWindowOptions: TailwindSelectOption<CompletionWindow>[] = useMemo(
    () => [
      { value: "today", label: t("dashboard.rangeToday") },
      { value: "week", label: t("dashboard.rangeWeek") },
      { value: "month", label: t("dashboard.rangeMonth") },
      { value: "year", label: t("dashboard.rangeYear") },
    ],
    [t],
  );
  const [choreScopeMenuOpen, setChoreScopeMenuOpen] = useState(false);
  const [choreFilterMenuOpen, setChoreFilterMenuOpen] = useState(false);
  const [expandedChoreFilterSection, setExpandedChoreFilterSection] =
    useState<ChoreFilterSection | null>(null);
  const [toolbarOptionsMenuOpen, setToolbarOptionsMenuOpen] = useState(false);
  const [toolbarMenuView, setToolbarMenuView] = useState<ToolbarMenuView>("root");
  const [quickSortState, setQuickSortState] = useState<QuickSortState | null>(readQuickSortState);
  const [choreFilters, setChoreFilters] =
    useState<DashboardChoreFilterState>(readDashboardChoreFilters);
  const [toolbarAddDialogOpen, setToolbarAddDialogOpen] = useState(false);
  const [busyActionsById, setBusyActionsById] = useState<Record<string, "delete" | "complete">>({});
  const [exitingChoreIds, setExitingChoreIds] = useState<Record<string, true>>({});
  const [optimisticallyCompletedIds, setOptimisticallyCompletedIds] = useState<Record<string, true>>({});
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<Record<string, true>>({});
  const [pendingCreateChoresByRequestId, setPendingCreateChoresByRequestId] =
    useState<Record<string, FamilySnapshotChore>>({});
  const [localOpenOrderIds, setLocalOpenOrderIds] = useState<string[] | null>(null);
  const [draggingChoreId, setDraggingChoreId] = useState("");
  const [dragOverChoreId, setDragOverChoreId] = useState("");
  const [dropIndicator, setDropIndicator] = useState<{
    choreId: string;
    position: "before" | "after";
  } | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [choreActionError, setChoreActionError] = useState("");
  const [pendingApproveChore, setPendingApproveChore] = useState<FamilySnapshotChore | null>(null);
  const [approvalSelectionsByAssignee, setApprovalSelectionsByAssignee] = useState<ApprovalAssigneeSelectionMap>({});
  const [choreScopeSelection, setChoreScopeSelection] =
    useState<ChoreScopeSelection | null>(readChoreScopeSelection);
  const [completionWindow, setCompletionWindow] = useState<CompletionWindow>(readCompletionWindow);
  const [completionCounts, setCompletionCounts] = useState<CompletionCount[]>([]);
  const [completionSeries, setCompletionSeries] =
    useState<CompletionSeries>(EMPTY_COMPLETION_SERIES);
  const [completionLoading, setCompletionLoading] = useState(true);
  const [completionError, setCompletionError] = useState("");
  const [hoveredCompletionRowMemberId, setHoveredCompletionRowMemberId] = useState<string | null>(null);
  const [hoveredCompletionChartMemberId, setHoveredCompletionChartMemberId] = useState<string | null>(null);
  const [completionStatsRefreshTick, setCompletionStatsRefreshTick] = useState(0);
  const [visibleChoreCount, setVisibleChoreCount] = useState(CHORE_PAGE_SIZE);
  const completionHideTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingApprovalAssigneeIds = useMemo(
    () => (pendingApproveChore ? getApprovalAssigneeIds(pendingApproveChore, members) : []),
    [members, pendingApproveChore],
  );


  useEffect(() => {
    let cancelled = false;
    async function loadPreference() {
      try {
        const response = await fetch("/api/preferences", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          completionWindow?: CompletionWindow | null;
        };
        if (cancelled) {
          return;
        }
        if (payload.completionWindow) {
          setCompletionWindow(payload.completionWindow);
          writeCompletionWindow(payload.completionWindow);
        }
      } catch {
        // Keep local fallback value.
      }
    }
    void loadPreference();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCompletionStats() {
      setCompletionLoading(true);
      setCompletionError("");
      try {
        const tzOffsetMinutes = new Date().getTimezoneOffset();
        const response = await fetch(
          `/api/chores/completion-stats?window=${completionWindow}&tzOffsetMinutes=${tzOffsetMinutes}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `COMPLETION_STATS_HTTP_${response.status}`);
        }
        const payload = (await response.json()) as CompletionStatsResponse;
        if (cancelled) {
          return;
        }
        setCompletionCounts(payload.counts ?? []);
        setCompletionSeries(payload.trend ?? EMPTY_COMPLETION_SERIES);
      } catch (statsError) {
        if (cancelled) {
          return;
        }
        setCompletionSeries(EMPTY_COMPLETION_SERIES);
        setCompletionError(normalizeError(statsError, "completion_stats_unavailable"));
      } finally {
        if (!cancelled) {
          setCompletionLoading(false);
        }
      }
    }
    void loadCompletionStats();
    return () => {
      cancelled = true;
    };
  }, [completionStatsReloadKey, completionWindow, completionStatsRefreshTick]);

  useEffect(() => {
    setOptimisticallyCompletedIds((current) => {
      const openChoreIds = new Set(chores.map((chore) => chore.id));
      let changed = false;
      const next: Record<string, true> = {};
      for (const choreId of Object.keys(current)) {
        if (openChoreIds.has(choreId)) {
          next[choreId] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [chores]);

  useEffect(() => {
    setOptimisticallyRemovedIds((current) => {
      const openChoreIds = new Set(chores.map((chore) => chore.id));
      let changed = false;
      const next: Record<string, true> = {};
      for (const choreId of Object.keys(current)) {
        if (openChoreIds.has(choreId)) {
          next[choreId] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [chores]);

  useEffect(() => {
    setExitingChoreIds((current) => {
      const openChoreIds = new Set(chores.map((chore) => chore.id));
      let changed = false;
      const next: Record<string, true> = {};
      for (const choreId of Object.keys(current)) {
        if (openChoreIds.has(choreId)) {
          next[choreId] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [chores]);

  useEffect(() => {
    setLocalOpenOrderIds(null);
  }, [chores]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(completionHideTimersRef.current)) {
        clearTimeout(timer);
      }
      completionHideTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const memberIds = new Set(completionSeries.series.map((member) => member.memberId));
    setHoveredCompletionRowMemberId((current) =>
      current && !memberIds.has(current) ? null : current,
    );
    setHoveredCompletionChartMemberId((current) =>
      current && !memberIds.has(current) ? null : current,
    );
  }, [completionSeries.series]);

  const viewerAssigneeIdSet = useMemo(
    () =>
      new Set(
        viewerAssigneeIds
          .map((value) => normalizeAssigneeAlias(value))
          .filter(Boolean),
      ),
    [viewerAssigneeIds],
  );
  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const viewerMember = useMemo(
    () =>
      activeMembers.find((member) =>
        Array.from(getMemberAliasSet(member)).some((alias) => viewerAssigneeIdSet.has(alias)),
      ) ?? null,
    [activeMembers, viewerAssigneeIdSet],
  );
  const defaultChoreScopeSelection: ChoreScopeSelection = viewerMember
    ? `member:${viewerMember.id}`
    : FAMILY_CHORE_SCOPE_SELECTION;
  const selectedChoreScope = useMemo<ChoreScopeSelection>(() => {
    if (choreScopeSelection === FAMILY_CHORE_SCOPE_SELECTION) {
      return choreScopeSelection;
    }
    if (choreScopeSelection?.startsWith("member:")) {
      const selectedMemberId = choreScopeSelection.slice("member:".length);
      if (activeMembers.some((member) => member.id === selectedMemberId)) {
        return choreScopeSelection;
      }
    }
    return defaultChoreScopeSelection;
  }, [activeMembers, choreScopeSelection, defaultChoreScopeSelection]);
  const selectedChoreMember = useMemo(() => {
    if (!selectedChoreScope.startsWith("member:")) {
      return null;
    }
    const selectedMemberId = selectedChoreScope.slice("member:".length);
    return activeMembers.find((member) => member.id === selectedMemberId) ?? null;
  }, [activeMembers, selectedChoreScope]);
  const memberByAlias = useMemo(() => {
    const map = new Map<string, FamilySnapshotMember>();
    for (const member of members) {
      map.set(member.id, member);
      if (member.uid) {
        map.set(member.uid, member);
      }
      const normalizedEmail = member.email.trim().toLowerCase();
      if (normalizedEmail) {
        map.set(normalizedEmail, member);
      }
    }
    return map;
  }, [members]);
  const pendingCreateChores = useMemo(
    () => Object.values(pendingCreateChoresByRequestId),
    [pendingCreateChoresByRequestId],
  );
  const baseOpenChores = useMemo(() => {
    const serverOpenChores = chores
      .filter(
        (chore) => !optimisticallyCompletedIds[chore.id] && !optimisticallyRemovedIds[chore.id],
      )
      .sort(compareChoresBySortOrderOrOldest);
    if (pendingCreateChores.length === 0) {
      return serverOpenChores;
    }
    const maxSortOrder = serverOpenChores.reduce((maxValue, chore) => {
      if (typeof chore.sortOrder !== "number") {
        return maxValue;
      }
      return Math.max(maxValue, chore.sortOrder);
    }, -1);
    const optimisticPending = pendingCreateChores
      .map((chore, index) => ({
        ...chore,
        sortOrder: maxSortOrder + index + 1,
      }))
      .sort(compareChoresBySortOrderOrOldest);
    return [...serverOpenChores, ...optimisticPending];
  }, [chores, optimisticallyCompletedIds, optimisticallyRemovedIds, pendingCreateChores]);
  const openChores = useMemo(() => {
    if (!localOpenOrderIds) {
      return baseOpenChores;
    }
    const choresById = new Map(baseOpenChores.map((chore) => [chore.id, chore] as const));
    const reordered = localOpenOrderIds
      .map((id) => choresById.get(id))
      .filter((chore): chore is FamilySnapshotChore => Boolean(chore));
    if (reordered.length !== baseOpenChores.length) {
      return baseOpenChores;
    }
    return reordered;
  }, [baseOpenChores, localOpenOrderIds]);
  const quickSortCountsByTitle = useMemo(() => {
    const counts = new Map<string, number>();
    if (quickSortState?.key !== "frequency") {
      return counts;
    }
    for (const chore of openChores) {
      const normalizedTitle = normalizeChoreTitle(chore.title || "");
      if (!normalizedTitle) {
        continue;
      }
      counts.set(normalizedTitle, (counts.get(normalizedTitle) ?? 0) + 1);
    }
    return counts;
  }, [openChores, quickSortState]);
  const sortedOpenChores = useMemo(() => {
    if (!quickSortState) {
      return openChores;
    }
    const indexById = new Map(openChores.map((chore, index) => [chore.id, index] as const));
    const directionMultiplier = quickSortState.direction === "asc" ? 1 : -1;
    return [...openChores].sort((a, b) => {
      let valueComparison = 0;
      if (quickSortState.key === "coin_value") {
        valueComparison = (a.coinValue ?? 0) - (b.coinValue ?? 0);
      } else if (quickSortState.key === "frequency") {
        const aFrequency = quickSortCountsByTitle.get(normalizeChoreTitle(a.title || "")) ?? 0;
        const bFrequency = quickSortCountsByTitle.get(normalizeChoreTitle(b.title || "")) ?? 0;
        valueComparison = aFrequency - bFrequency;
      } else {
        valueComparison = (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        });
      }
      if (valueComparison !== 0) {
        return valueComparison * directionMultiplier;
      }
      return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
    });
  }, [openChores, quickSortCountsByTitle, quickSortState]);
  const scopedOpenChores = useMemo(() => {
    if (selectedChoreScope === FAMILY_CHORE_SCOPE_SELECTION || !selectedChoreMember) {
      return sortedOpenChores;
    }
    return sortedOpenChores.filter((chore) => choreMatchesMember(chore, selectedChoreMember));
  }, [selectedChoreMember, selectedChoreScope, sortedOpenChores]);
  const filterCategoryOptions = useMemo(() => {
    const categoryById = new Map<string, NonNullable<FamilySnapshotChore["categories"]>[number]>();
    for (const chore of scopedOpenChores) {
      for (const category of chore.categories ?? []) {
        if (category.id && !categoryById.has(category.id)) {
          categoryById.set(category.id, category);
        }
      }
    }
    return Array.from(categoryById.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedOpenChores]);
  const filterCategoryIdSet = useMemo(
    () => new Set(filterCategoryOptions.map((category) => category.id)),
    [filterCategoryOptions],
  );
  useEffect(() => {
    setChoreFilters((current) => {
      const nextCategoryIds = current.categoryIds.filter((categoryId) =>
        filterCategoryIdSet.has(categoryId),
      );
      return nextCategoryIds.length === current.categoryIds.length
        ? current
        : { ...current, categoryIds: nextCategoryIds };
    });
  }, [filterCategoryIdSet]);
  useEffect(() => {
    writeDashboardChoreFilters(choreFilters);
  }, [choreFilters]);
  const activeChoreFilterCount =
    choreFilters.categoryIds.length +
    choreFilters.choreTypes.length +
    (choreFilters.dueFrom || choreFilters.dueTo ? 1 : 0);
  const dueDateFilterCount = choreFilters.dueFrom || choreFilters.dueTo ? 1 : 0;
  const hasActiveChoreFilters = activeChoreFilterCount > 0;
  const filteredOpenChores = useMemo(() => {
    if (!hasActiveChoreFilters) {
      return scopedOpenChores;
    }
    return scopedOpenChores.filter((chore) => {
      if (
        choreFilters.categoryIds.length > 0 &&
        !choreFilters.categoryIds.some((categoryId) => (chore.categoryIds ?? []).includes(categoryId))
      ) {
        return false;
      }
      if (choreFilters.choreTypes.length > 0) {
        const choreType = chore.choreType ?? "normal";
        if (!choreFilters.choreTypes.includes(choreType)) {
          return false;
        }
      }
      if (choreFilters.dueFrom && (!chore.dueDate || chore.dueDate < choreFilters.dueFrom)) {
        return false;
      }
      if (choreFilters.dueTo && (!chore.dueDate || chore.dueDate > choreFilters.dueTo)) {
        return false;
      }
      return true;
    });
  }, [choreFilters, hasActiveChoreFilters, scopedOpenChores]);
  const categoryLabelById = useMemo(
    () => new Map(filterCategoryOptions.map((category) => [category.id, category.name] as const)),
    [filterCategoryOptions],
  );
  const choreTypeLabels = useMemo<Record<ChoreType, string>>(
    () => ({
      see_and_do: t("dashboard.filterTypeSeeAndDo"),
      group: t("dashboard.filterTypeGroup"),
      normal: t("dashboard.filterTypeNormal"),
    }),
    [t],
  );
  const activeChoreFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onRemove: () => void }> = [];
    for (const categoryId of choreFilters.categoryIds) {
      chips.push({
        id: `category:${categoryId}`,
        label: t("dashboard.activeCategoryFilter", {
          value: categoryLabelById.get(categoryId) ?? t("dashboard.unknownCategory"),
        }),
        onRemove: () =>
          setChoreFilters((current) => ({
            ...current,
            categoryIds: current.categoryIds.filter((id) => id !== categoryId),
          })),
      });
    }
    for (const choreType of choreFilters.choreTypes) {
      chips.push({
        id: `type:${choreType}`,
        label: t("dashboard.activeTypeFilter", { value: choreTypeLabels[choreType] }),
        onRemove: () =>
          setChoreFilters((current) => ({
            ...current,
            choreTypes: current.choreTypes.filter((type) => type !== choreType),
          })),
      });
    }
    if (choreFilters.dueFrom || choreFilters.dueTo) {
      const value =
        choreFilters.dueFrom && choreFilters.dueTo
          ? t("dashboard.filterDueDateRangeValue", {
              from: formatFilterDate(choreFilters.dueFrom),
              to: formatFilterDate(choreFilters.dueTo),
            })
          : choreFilters.dueFrom
            ? t("dashboard.filterDueDateFromValue", {
                from: formatFilterDate(choreFilters.dueFrom),
              })
            : t("dashboard.filterDueDateToValue", {
                to: formatFilterDate(choreFilters.dueTo),
              });
      chips.push({
        id: "due-date",
        label: t("dashboard.activeDueDateFilter", { value }),
        onRemove: () => setChoreFilters((current) => ({ ...current, dueFrom: "", dueTo: "" })),
      });
    }
    return chips;
  }, [categoryLabelById, choreFilters, choreTypeLabels, t]);
  const pendingCreateChoreIdSet = useMemo(
    () => new Set(Object.values(pendingCreateChoresByRequestId).map((chore) => chore.id)),
    [pendingCreateChoresByRequestId],
  );
  const visibleChores = filteredOpenChores;
  const visibleChorePage = useMemo(
    () => getDashboardChorePage(visibleChores, visibleChoreCount),
    [visibleChoreCount, visibleChores],
  );
  const visibleChoreIndexById = useMemo(
    () => new Map(visibleChores.map((chore, index) => [chore.id, index] as const)),
    [visibleChores],
  );
  useEffect(() => {
    setVisibleChoreCount(CHORE_PAGE_SIZE);
  }, [selectedChoreScope, quickSortState, chores, choreFilters]);
  const hasBusyChoreAction = Object.keys(busyActionsById).length > 0;
  const hasPendingCreates = Object.keys(pendingCreateChoresByRequestId).length > 0;
  const canReorderChores =
    viewerRole === "admin" &&
    !hasBusyChoreAction &&
    !hasPendingCreates &&
    !hasActiveChoreFilters &&
    quickSortState === null;
  useEffect(() => {
    if (canReorderChores) {
      return;
    }
    setDraggingChoreId("");
    setDragOverChoreId("");
    setDropIndicator(null);
  }, [canReorderChores]);
  const completionMax = useMemo(
    () => Math.max(1, ...completionCounts.map((entry) => entry.count)),
    [completionCounts],
  );
  const completionTrendHasData = useMemo(
    () => completionSeries.series.some((member) => member.points.some((point) => point > 0)),
    [completionSeries.series],
  );
  const completionSeriesIndexByMemberId = useMemo(() => {
    return new Map(completionSeries.series.map((member, index) => [member.memberId, index]));
  }, [completionSeries.series]);
  const activeCompletionGlowMemberId =
    hoveredCompletionChartMemberId ?? hoveredCompletionRowMemberId;
  const activeCompletionGlowDatasetIndex =
    activeCompletionGlowMemberId
      ? completionSeriesIndexByMemberId.get(activeCompletionGlowMemberId) ?? null
      : null;
  const completionLineGlowPlugin = useMemo<Plugin<"line">>(
    () => ({
      id: "completionLineGoldGlow",
      beforeDatasetDraw(chart, args) {
        if (activeCompletionGlowDatasetIndex === null || args.index !== activeCompletionGlowDatasetIndex) {
          return;
        }
        const ctx = chart.ctx;
        ctx.save();
        ctx.shadowColor = "rgba(245, 158, 11, 0.5)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      },
      afterDatasetDraw(chart, args) {
        if (activeCompletionGlowDatasetIndex === null || args.index !== activeCompletionGlowDatasetIndex) {
          return;
        }
        chart.ctx.restore();
      },
    }),
    [activeCompletionGlowDatasetIndex],
  );
  const completionTrendLineData = useMemo<ChartData<"line">>(() => {
    const labels = completionSeries.labels.map((label) =>
      formatCompletionBucketLabel(label, completionWindow),
    );
    return {
      labels,
      datasets: completionSeries.series.map((member, index) => ({
        label: member.name,
        data: member.points,
        borderColor:
          member.color || COMPLETION_LINE_COLORS[index % COMPLETION_LINE_COLORS.length],
        backgroundColor:
          member.color || COMPLETION_LINE_COLORS[index % COMPLETION_LINE_COLORS.length],
        pointRadius: 3,
        pointHoverRadius: 4,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.4,
        borderWidth: 2.5,
        tension: 0.28,
        fill: false,
      })),
    };
  }, [completionSeries, completionWindow]);
  const completionTrendLineOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      layout: {
        padding: {
          top: 16,
          right: 8,
          left: 4,
          bottom: 0,
        },
      },
      scales: {
        x: {
          offset: true,
          grid: {
            display: false,
          },
          border: {
            color: "#aec8eb",
          },
          ticks: {
            color: "#5977a1",
            padding: 8,
            minRotation: 45,
            maxRotation: 45,
            align: "end",
            autoSkip: true,
            maxTicksLimit:
              completionWindow === "today" ? 8 : completionWindow === "year" ? 10 : 12,
            font: {
              size: 11,
              weight: 700,
            },
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(1, completionSeries.maxCount),
          border: {
            color: "#aec8eb",
          },
          grid: {
            color: "#dce9fa",
          },
          ticks: {
            precision: 0,
            color: "#5a78a1",
            font: {
              size: 11,
              weight: 700,
            },
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
        },
      },
      onHover: (event, _elements, chart) => {
        const nativeEvent = event.native;
        if (!nativeEvent) {
          setHoveredCompletionChartMemberId((current) => (current === null ? current : null));
          return;
        }
        const datasetElements = chart.getElementsAtEventForMode(
          nativeEvent as Event,
          "dataset",
          { intersect: true },
          false,
        );
        const hoveredDatasetIndex = datasetElements[0]?.datasetIndex;
        const nextHoveredMemberId =
          hoveredDatasetIndex === undefined
            ? null
            : completionSeries.series[hoveredDatasetIndex]?.memberId ?? null;
        setHoveredCompletionChartMemberId((current) =>
          current === nextHoveredMemberId ? current : nextHoveredMemberId,
        );
      },
    }),
    [completionSeries.maxCount, completionSeries.series, completionWindow],
  );

  function updateChoreScopeSelection(next: ChoreScopeSelection) {
    setChoreScopeSelection(next);
    writeChoreScopeSelection(next);
    setChoreScopeMenuOpen(false);
  }

  function toggleChoreFilterValue<Key extends "categoryIds" | "choreTypes">(
    key: Key,
    value: DashboardChoreFilterState[Key][number],
  ) {
    setChoreFilters((current) => {
      const values = current[key] as string[];
      const nextValues = values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value];
      return { ...current, [key]: nextValues };
    });
  }

  function resetChoreFilters() {
    setChoreFilters(EMPTY_DASHBOARD_CHORE_FILTERS);
  }

  function toggleChoreFilterSection(section: ChoreFilterSection) {
    setExpandedChoreFilterSection((current) => (current === section ? null : section));
  }

  function updateCompletionWindow(next: CompletionWindow) {
    setCompletionWindow(next);
    writeCompletionWindow(next);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completionWindow: next }),
    }).catch(() => {
      // Keep local value; retry will happen on next selection.
    });
  }

  function onSelectQuickSort(nextKey: QuickSortKey) {
    setQuickSortState((current) => {
      let next: QuickSortState;
      if (!current || current.key !== nextKey) {
        next = { key: nextKey, direction: QUICK_SORT_DEFAULT_DIRECTION[nextKey] };
      } else {
        next = { key: nextKey, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      writeQuickSortState(next);
      return next;
    });
    setToolbarOptionsMenuOpen(false);
    setToolbarMenuView("root");
  }

  function onToolbarOptionsMenuOpenChange(next: boolean) {
    setToolbarOptionsMenuOpen(next);
    if (!next) {
      setToolbarMenuView("root");
    }
  }

  function onChoreFilterMenuOpenChange(next: boolean) {
    setChoreFilterMenuOpen(next);
  }

  function openToolbarSortMenu() {
    setToolbarMenuView("sort");
    setToolbarOptionsMenuOpen(true);
  }

  function quickSortDirectionLabel(key: QuickSortKey, direction: QuickSortDirection) {
    if (key === "coin_value") {
      return direction === "asc" ? "Low to high" : "High to low";
    }
    if (key === "frequency") {
      return direction === "asc" ? "Least common first" : "Most common first";
    }
    return direction === "asc" ? "A to Z" : "Z to A";
  }

  async function onChoreSaved(result: AddEditChoreSavedResult) {
    if (result.mode === "create") {
      const requestId = result.requestId;
      const pendingChore = result.pendingChore;
      if (result.phase === "pending" && requestId && pendingChore) {
        setPendingCreateChoresByRequestId((current) => ({
          ...current,
          [requestId]: {
            id: pendingChore.id,
            title: pendingChore.title,
            choreType: pendingChore.choreType,
            status: "Open",
            assigneeId: pendingChore.assigneeId,
            assigneeName: pendingChore.assigneeName,
            dueDate: pendingChore.dueDate,
            details: pendingChore.details,
            categoryIds: pendingChore.categoryIds,
            categories: pendingChore.categories,
            coinValue: pendingChore.coinValue,
            requireApproval: pendingChore.requireApproval,
            recurrenceType: pendingChore.recurrenceType,
            recurrenceInterval: pendingChore.recurrenceInterval,
            recurrenceUnit: pendingChore.recurrenceUnit,
            source: "manual",
            createdAt: new Date().toISOString(),
          },
        }));
        return;
      }
      if (requestId) {
        setPendingCreateChoresByRequestId((current) => {
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
      if (result.phase === "error") {
        setChoreActionError(result.error || "create_chore_failed");
        return;
      }
      await onReload();
      await markDiscoverySeen(["chores"]);
      return;
    }

    if (result.phase === "error") {
      setChoreActionError(result.error || "update_chore_failed");
      return;
    }
    if (result.phase === "success") {
      await onReload();
      await markDiscoverySeen(["chores"]);
    }
  }

  async function onDeleteChore(choreId: string) {
    if (busyActionsById[choreId]) {
      return;
    }
    setChoreActionError("");
    setBusyActionsById((current) => ({ ...current, [choreId]: "delete" }));
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      setOptimisticallyRemovedIds((current) => ({ ...current, [choreId]: true }));
      await onReload();
    } catch (removeError) {
      setChoreActionError(normalizeError(removeError, "remove_chore_failed"));
    } finally {
      setBusyActionsById((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
    }
  }

  async function onCompleteChore(
    choreId: string,
    source?: { clientX: number; clientY: number },
  ) {
    const chore = openChores.find((entry) => entry.id === choreId);
    if (busyActionsById[choreId]) {
      return;
    }
    const isMultiOrFamily =
      chore?.assigneeScope === "family" || (chore?.assigneeIds?.length ?? 0) > 1;
    const needsApprovalCoinPrompt = isMultiOrFamily || chore?.choreType === "see_and_do";
    if (viewerRole === "admin" && chore && needsApprovalCoinPrompt) {
      const assigneeIds = getApprovalAssigneeIds(chore, members);
      setApprovalSelectionsByAssignee(
        createApprovalAssigneeSelections(assigneeIds, chore.coinValue ?? 0),
      );
      setPendingApproveChore(chore);
      return;
    }
    setChoreActionError("");
    setBusyActionsById((current) => ({ ...current, [choreId]: "complete" }));
    setExitingChoreIds((current) => ({ ...current, [choreId]: true }));
    const existingTimer = completionHideTimersRef.current[choreId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    completionHideTimersRef.current[choreId] = setTimeout(() => {
      setOptimisticallyCompletedIds((current) => ({ ...current, [choreId]: true }));
      setExitingChoreIds((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
      delete completionHideTimersRef.current[choreId];
    }, CHORE_EXIT_ANIMATION_MS);
    triggerPartyConfetti({
      intensity: 1.3,
      sourceClientX: source?.clientX,
      sourceClientY: source?.clientY,
      showAllDone: true,
    });
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `COMPLETE_CHORE_HTTP_${response.status}`);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
        window.dispatchEvent(new Event("notifications:refresh"));
      }
    } catch (completeError) {
      setChoreActionError(normalizeError(completeError, "complete_chore_failed"));
      const pendingTimer = completionHideTimersRef.current[choreId];
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        delete completionHideTimersRef.current[choreId];
      }
      setExitingChoreIds((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
      setOptimisticallyCompletedIds((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
    } finally {
      setBusyActionsById((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
    }
  }

  async function onCompleteAndApproveFromDashboard() {
    if (!pendingApproveChore || busyActionsById[pendingApproveChore.id]) {
      return;
    }
    const choreId = pendingApproveChore.id;
    setChoreActionError("");
    setBusyActionsById((current) => ({ ...current, [choreId]: "complete" }));
    try {
      const completeResponse = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          approvalPayouts: listApprovalPayouts(approvalSelectionsByAssignee, pendingApprovalAssigneeIds),
        }),
      });
      if (!completeResponse.ok) {
        const body = (await completeResponse.json()) as { error?: string };
        throw new Error(body.error ?? `COMPLETE_CHORE_HTTP_${completeResponse.status}`);
      }
      setPendingApproveChore(null);
      setApprovalSelectionsByAssignee({});
      await onReload();
      setCompletionStatsRefreshTick((current) => current + 1);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
        window.dispatchEvent(new Event("notifications:refresh"));
      }
    } catch (error) {
      setChoreActionError(normalizeError(error, "complete_and_approve_failed"));
    } finally {
      setBusyActionsById((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
    }
  }

  async function onDropReorder(targetChoreId: string, position: "before" | "after") {
    if (!canReorderChores || reorderBusy || !draggingChoreId) {
      return;
    }
    const currentIds = openChores.map((chore) => chore.id);
    const nextIds = reorderChoreIds(currentIds, draggingChoreId, targetChoreId, position);
    setDragOverChoreId("");
    setDraggingChoreId("");
    setDropIndicator(null);
    if (nextIds.join("|") === currentIds.join("|")) {
      return;
    }
    setLocalOpenOrderIds(nextIds);
    setReorderBusy(true);
    setChoreActionError("");
    try {
      const response = await fetch("/api/chores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          orderedChoreIds: nextIds,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REORDER_CHORES_HTTP_${response.status}`);
      }
      await onReload();
    } catch (reorderError) {
      setLocalOpenOrderIds(currentIds);
      setChoreActionError(normalizeError(reorderError, "reorder_chores_failed"));
    } finally {
      setReorderBusy(false);
    }
  }

  async function onStepReorder(choreId: string, direction: -1 | 1) {
    if (!canReorderChores || reorderBusy) {
      return;
    }
    const currentIds = visibleChores.map((chore) => chore.id);
    const currentIndex = currentIds.indexOf(choreId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentIds.length) {
      return;
    }
    const nextIds = [...currentIds];
    nextIds.splice(currentIndex, 1);
    nextIds.splice(nextIndex, 0, choreId);
    if (nextIds.join("|") === currentIds.join("|")) {
      return;
    }
    setLocalOpenOrderIds(nextIds);
    setReorderBusy(true);
    setChoreActionError("");
    try {
      const response = await fetch("/api/chores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          orderedChoreIds: nextIds,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REORDER_CHORES_HTTP_${response.status}`);
      }
      await onReload();
    } catch (reorderError) {
      setLocalOpenOrderIds(currentIds);
      setChoreActionError(normalizeError(reorderError, "reorder_chores_failed"));
    } finally {
      setReorderBusy(false);
    }
  }

  const completionRowBaseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", "completed");
    params.set("completedWindow", completionWindow);
    params.set("tzOffsetMinutes", String(new Date().getTimezoneOffset()));
    return params;
  }, [completionWindow]);

  return (
    <article className="today-chores-dashboard">
      <div className="today-chores-layout">
        <div className="family-panel today-chores-main">
          <div className="today-chores-toolbar">
            <div className="today-chores-controls-group">
              <AppMenu
                open={choreScopeMenuOpen}
                onOpenChange={setChoreScopeMenuOpen}
                wrapperClassName="today-chores-scope-wrap"
                triggerClassName="btn btn-secondary today-chores-scope-trigger"
                triggerTitle="Choose chore view"
                triggerAriaLabel="Choose chore view"
                panelClassName="app-menu-panel profile-dropdown today-chores-scope-menu"
                trigger={
                  <>
                    {selectedChoreMember ? (
                      <FamilyMemberAvatar
                        className="completion-chart-avatar today-chores-scope-avatar"
                        name={selectedChoreMember.name}
                        avatarId={selectedChoreMember.avatarId}
                        avatarPhotoUrl={selectedChoreMember.avatarPhotoUrl}
                        primaryColor={getSafeHexColor(selectedChoreMember.dashboardPrimaryColor) || undefined}
                        size={28}
                        borderWidth={2}
                        ariaHidden
                      />
                    ) : (
                      <FamilyMemberAvatar
                        className="today-chores-family-avatar"
                        name="Family"
                        size={30}
                        borderWidth={2}
                        isFamily
                        ariaHidden
                      />
                    )}
                    <span className="today-chores-scope-trigger-text">
                      {selectedChoreMember?.name || "Family"}
                    </span>
                    {selectedChoreMember ? (
                      <span className="today-chores-scope-coins" aria-label={`${selectedChoreMember.stats.currentCoins} coins`}>
                        <CoinIcon size={12} />
                        <span>{formatCompactBalance(selectedChoreMember.stats.currentCoins)}</span>
                      </span>
                    ) : null}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className={`today-chores-scope-caret${choreScopeMenuOpen ? " is-open" : ""}`}>
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </>
                }>
                <button
                  type="button"
                  role="menuitem"
                  className={`theme-select-option today-chores-scope-option${
                    selectedChoreScope === FAMILY_CHORE_SCOPE_SELECTION ? " theme-select-option-selected" : ""
                  }`}
                  onClick={() => updateChoreScopeSelection(FAMILY_CHORE_SCOPE_SELECTION)}>
                  <span className="today-chores-scope-option-main">
                    <FamilyMemberAvatar
                      className="today-chores-family-avatar"
                      name="Family"
                      size={30}
                      borderWidth={2}
                      isFamily
                      ariaHidden
                    />
                    <span className="today-chores-scope-option-copy">
                      <span>All Family</span>
                      <span>All open chores</span>
                    </span>
                  </span>
                  <span className="today-chores-scope-option-check" aria-hidden="true">
                    {selectedChoreScope === FAMILY_CHORE_SCOPE_SELECTION ? "\u2713" : ""}
                  </span>
                </button>
                {activeMembers.map((member) => {
                  const selection: ChoreScopeSelection = `member:${member.id}`;
                  const primaryColor = getSafeHexColor(member.dashboardPrimaryColor) || "#1f69b7";
                  return (
                    <button
                      key={member.id}
                      type="button"
                      role="menuitem"
                      className={`theme-select-option today-chores-scope-option${
                        selectedChoreScope === selection ? " theme-select-option-selected" : ""
                      }`}
                      onClick={() => updateChoreScopeSelection(selection)}>
                      <span className="today-chores-scope-option-main">
                        <FamilyMemberAvatar
                          className="completion-chart-avatar today-chores-scope-avatar"
                          name={member.name}
                          avatarId={member.avatarId}
                          avatarPhotoUrl={member.avatarPhotoUrl}
                          primaryColor={primaryColor}
                          size={30}
                          borderWidth={2}
                          ariaHidden
                        />
                        <span className="today-chores-scope-option-copy">
                          <span>{member.name}</span>
                          <span>{member.role === "admin" ? t("dashboard.scopeParent") : t("dashboard.scopeKid")}</span>
                        </span>
                      </span>
                      <span className="today-chores-scope-option-trailing">
                        <span className="today-chores-scope-coins" aria-label={`${member.stats.currentCoins} coins`}>
                          <CoinIcon size={12} />
                          <span>{formatCompactBalance(member.stats.currentCoins)}</span>
                        </span>
                        <span className="today-chores-scope-option-check" aria-hidden="true">
                          {selectedChoreScope === selection ? "\u2713" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </AppMenu>
              <AppMenu
                open={choreFilterMenuOpen}
                onOpenChange={onChoreFilterMenuOpenChange}
                wrapperClassName="today-chores-filter-wrap"
                triggerClassName={`btn btn-secondary today-chores-filter-trigger${
                  hasActiveChoreFilters ? " today-chores-action-filter-trigger-active" : ""
                }`}
                triggerTitle={t("dashboard.filter")}
                triggerAriaLabel={t("dashboard.filter")}
                panelClassName="app-menu-panel family-action-dropdown today-chores-filter-menu"
                trigger={
                  <>
                    <FilterMenuIcon />
                    {activeChoreFilterCount > 0 ? (
                      <span className="today-chores-filter-count" aria-hidden="true">
                        {activeChoreFilterCount}
                      </span>
                    ) : null}
                  </>
                }>
                <div className="today-chores-filter-menu-section">
                  <button
                    type="button"
                    className="today-chores-filter-section-trigger"
                    aria-expanded={expandedChoreFilterSection === "category"}
                    onClick={() => toggleChoreFilterSection("category")}>
                    <span className="today-chores-filter-menu-label">{t("dashboard.filterCategory")}</span>
                    <span className="today-chores-filter-section-meta">
                      {choreFilters.categoryIds.length > 0 ? (
                        <span className="today-chores-filter-section-count">{choreFilters.categoryIds.length}</span>
                      ) : null}
                      <FilterSectionCaret open={expandedChoreFilterSection === "category"} />
                    </span>
                  </button>
                  {expandedChoreFilterSection === "category" ? (
                    <div className="today-chores-filter-menu-options">
                      {filterCategoryOptions.length > 0 ? (
                        filterCategoryOptions.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={choreFilters.categoryIds.includes(category.id)}
                            className={`today-chores-filter-option${
                              choreFilters.categoryIds.includes(category.id) ? " is-active" : ""
                            }`}
                            onClick={() => toggleChoreFilterValue("categoryIds", category.id)}>
                            <span
                              className="today-chores-filter-option-swatch"
                              style={{ backgroundColor: getSafeHexColor(category.color) || "#94a3b8" }}
                              aria-hidden="true"
                            />
                            <span>{category.name}</span>
                            <span className="today-chores-filter-option-check" aria-hidden="true">
                              {choreFilters.categoryIds.includes(category.id) ? "\u2713" : ""}
                            </span>
                          </button>
                        ))
                      ) : (
                        <span className="today-chores-filter-empty">{t("dashboard.noCategoryFilters")}</span>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="today-chores-filter-menu-section">
                  <button
                    type="button"
                    className="today-chores-filter-section-trigger"
                    aria-expanded={expandedChoreFilterSection === "type"}
                    onClick={() => toggleChoreFilterSection("type")}>
                    <span className="today-chores-filter-menu-label">{t("dashboard.filterType")}</span>
                    <span className="today-chores-filter-section-meta">
                      {choreFilters.choreTypes.length > 0 ? (
                        <span className="today-chores-filter-section-count">{choreFilters.choreTypes.length}</span>
                      ) : null}
                      <FilterSectionCaret open={expandedChoreFilterSection === "type"} />
                    </span>
                  </button>
                  {expandedChoreFilterSection === "type" ? (
                    <div className="today-chores-filter-menu-options">
                      {DASHBOARD_CHORE_TYPES.map((choreType) => (
                        <button
                          key={choreType}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={choreFilters.choreTypes.includes(choreType)}
                          className={`today-chores-filter-option${
                            choreFilters.choreTypes.includes(choreType) ? " is-active" : ""
                          }`}
                          onClick={() => toggleChoreFilterValue("choreTypes", choreType)}>
                          <span>{choreTypeLabels[choreType]}</span>
                          <span className="today-chores-filter-option-check" aria-hidden="true">
                            {choreFilters.choreTypes.includes(choreType) ? "\u2713" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="today-chores-filter-menu-section">
                  <button
                    type="button"
                    className="today-chores-filter-section-trigger"
                    aria-expanded={expandedChoreFilterSection === "dueDate"}
                    onClick={() => toggleChoreFilterSection("dueDate")}>
                    <span className="today-chores-filter-menu-label">{t("dashboard.filterDueDate")}</span>
                    <span className="today-chores-filter-section-meta">
                      {dueDateFilterCount > 0 ? (
                        <span className="today-chores-filter-section-count">{dueDateFilterCount}</span>
                      ) : null}
                      <FilterSectionCaret open={expandedChoreFilterSection === "dueDate"} />
                    </span>
                  </button>
                  {expandedChoreFilterSection === "dueDate" ? (
                    <div className="today-chores-filter-date-range">
                      <label>
                        <span>{t("dashboard.filterDueFrom")}</span>
                        <input
                          type="date"
                          value={choreFilters.dueFrom}
                          onChange={(event) =>
                            setChoreFilters((current) => ({ ...current, dueFrom: event.target.value }))
                          }
                        />
                      </label>
                      <label>
                        <span>{t("dashboard.filterDueTo")}</span>
                        <input
                          type="date"
                          value={choreFilters.dueTo}
                          onChange={(event) =>
                            setChoreFilters((current) => ({ ...current, dueTo: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
                <div className="today-chores-filter-menu-footer">
                  <Button
                    type="button"
                    className="btn btn-secondary today-chores-filter-reset"
                    disabled={!hasActiveChoreFilters}
                    onClick={resetChoreFilters}>
                    {t("dashboard.clearFilters")}
                  </Button>
                </div>
              </AppMenu>
              <AppMenu
                open={toolbarOptionsMenuOpen}
                onOpenChange={onToolbarOptionsMenuOpenChange}
                wrapperClassName="today-chores-options-wrap"
                triggerClassName={`btn btn-secondary today-chores-options-trigger${
                  toolbarMenuView === "sort" || quickSortState ? " today-chores-action-sort-trigger-active" : ""
                }`}
                triggerTitle={t("dashboard.toolbarOptions")}
                triggerAriaLabel={t("dashboard.toolbarOptions")}
                panelClassName="app-menu-panel family-action-dropdown today-chores-toolbar-menu"
                trigger={<ToolbarOptionsIcon />}>
                {toolbarMenuView === "root" ? (
                  <>
                    <MenuActionButton fullWidth onClick={openToolbarSortMenu} leading={<SortMenuIcon />}>
                      {t("dashboard.sort")}
                    </MenuActionButton>
                    <MenuActionLink
                      href="/chores"
                      fullWidth
                      leading={<ViewAllChoresIcon />}
                      onClick={() => setToolbarOptionsMenuOpen(false)}>
                      {t("dashboard.viewAllChores")}
                    </MenuActionLink>
                  </>
                ) : (
                  <>
                    <MenuActionButton fullWidth onClick={() => setToolbarMenuView("root")} leading={<BackMenuIcon />}>
                      {t("common.actions.back")}
                    </MenuActionButton>
                    <MenuActionButton
                      fullWidth
                      onClick={() => onSelectQuickSort("coin_value")}
                      leading={<SortMenuIcon />}
                      trailing={
                        quickSortState?.key === "coin_value"
                          ? quickSortDirectionLabel("coin_value", quickSortState.direction)
                          : null
                      }
                      trailingClassName="today-chores-sort-menu-direction">
                      {t("dashboard.sortCoinValue")}
                    </MenuActionButton>
                    <MenuActionButton
                      fullWidth
                      onClick={() => onSelectQuickSort("frequency")}
                      leading={<SortMenuIcon />}
                      trailing={
                        quickSortState?.key === "frequency"
                          ? quickSortDirectionLabel("frequency", quickSortState.direction)
                          : null
                      }
                      trailingClassName="today-chores-sort-menu-direction">
                      {t("dashboard.sortFrequency")}
                    </MenuActionButton>
                    <MenuActionButton
                      fullWidth
                      onClick={() => onSelectQuickSort("alphabetical")}
                      leading={<SortMenuIcon />}
                      trailing={
                        quickSortState?.key === "alphabetical"
                          ? quickSortDirectionLabel("alphabetical", quickSortState.direction)
                          : null
                      }
                      trailingClassName="today-chores-sort-menu-direction">
                      {t("dashboard.sortAlphabetical")}
                    </MenuActionButton>
                  </>
                )}
              </AppMenu>
            </div>
            {canCreateChores ? (
              <div className="today-chores-actions-desktop">
                <Button
                  type="button"
                  title={t("dashboard.addMoreChores")}
                  aria-label={t("dashboard.addMoreChores")}
                  className="btn today-chores-action-add"
                  onClick={() => setToolbarAddDialogOpen(true)}>
                  <span className="today-chores-add-btn-content">
                    <AddMenuIcon />
                    <span>{playerSeeAndDoMode ? t("dashboard.addSeeAndDoChore") : t("dashboard.addChore")}</span>
                  </span>
                </Button>
              </div>
            ) : null}
            {canCreateChores ? (
              <AddEditChoresDialog
                createMode={playerSeeAndDoMode ? "see_and_do" : "default"}
                defaultAssigneeIds={selectedChoreMember ? [selectedChoreMember.id] : selectedChoreScope === FAMILY_CHORE_SCOPE_SELECTION ? [FAMILY_ASSIGNEE_OPTION_ID] : undefined}
                hideTrigger
                open={toolbarAddDialogOpen}
                onOpenChange={setToolbarAddDialogOpen}
                onSaved={onChoreSaved}
              />
            ) : null}
          </div>
          {activeChoreFilterChips.length > 0 ? (
            <div className="today-chores-active-filters" aria-label={t("dashboard.activeFilters")}>
              {activeChoreFilterChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="today-chores-active-filter-chip"
                  onClick={chip.onRemove}
                  title={t("dashboard.removeFilter", { value: chip.label })}>
                  <span>{chip.label}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
              <button
                type="button"
                className="today-chores-active-filter-clear"
                onClick={resetChoreFilters}>
                {t("dashboard.clearFilters")}
              </button>
            </div>
          ) : null}
          {choreActionError ? <Alert className="mb-3">{t("dashboard.choreUpdateError", { error: choreActionError })}</Alert> : null}
          {visibleChores.length === 0 ? (
            <div className="dashboard-empty-state">
              <span className="dashboard-empty-state-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 4.5h6a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1Z" />
                  <path d="M8 5.5H6a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2" />
                  <path d="m9 13 2 2 4-4" />
                </svg>
              </span>
              <h4 className="dashboard-empty-state-title">
                {selectedChoreMember
                  ? t("dashboard.emptyHeadingMember", { name: selectedChoreMember.name })
                  : t("dashboard.emptyHeading")}
              </h4>
              <p className="dashboard-empty-state-body">
                {selectedChoreMember
                  ? t("dashboard.noChoresAssigned", { name: selectedChoreMember.name })
                  : t("dashboard.noOpenChores")}
              </p>
              <GhostChoreEmptyStateSuggestions
                assigneeId={selectedChoreMember?.id}
                assigneeName={selectedChoreMember?.name}
                onAdded={onReload}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="family-list">
                {visibleChorePage.visibleItems.map((chore) => (
                  <TodayChoreCard
                    key={chore.id}
                    chore={chore}
                    isAdminViewer={viewerRole === "admin"}
                    canManageActions={
                      viewerRole === "admin" && !pendingCreateChoreIdSet.has(chore.id)
                    }
                    canComplete={
                      !pendingCreateChoreIdSet.has(chore.id) &&
                      (viewerRole === "admin" ||
                        (chore.assigneeIds ?? []).some((id) =>
                          viewerAssigneeIdSet.has(normalizeAssigneeAlias(id)),
                        ) ||
                        Boolean(chore.assigneeId && viewerAssigneeIdSet.has(normalizeAssigneeAlias(chore.assigneeId))))
                    }
                    canReorder={canReorderChores && !reorderBusy}
                    canMoveUp={(visibleChoreIndexById.get(chore.id) ?? -1) > 0}
                    canMoveDown={
                      (() => {
                        const index = visibleChoreIndexById.get(chore.id) ?? -1;
                        return index >= 0 && index < visibleChores.length - 1;
                      })()
                    }
                    isDragging={draggingChoreId === chore.id}
                    isDragOver={dragOverChoreId === chore.id}
                    dropIndicatorPosition={
                      dropIndicator?.choreId === chore.id ? dropIndicator.position : null
                    }
                    busyAction={
                      busyActionsById[chore.id] ?? ""
                    }
                    disabled={
                      Boolean(busyActionsById[chore.id]) ||
                      reorderBusy ||
                      pendingCreateChoreIdSet.has(chore.id)
                    }
                    isExiting={Boolean(exitingChoreIds[chore.id])}
                    isCreatePending={pendingCreateChoreIdSet.has(chore.id)}
                    onDelete={onDeleteChore}
                    onComplete={onCompleteChore}
                    onMoveUp={(choreId) => onStepReorder(choreId, -1)}
                    onMoveDown={(choreId) => onStepReorder(choreId, 1)}
                    onDragStart={(choreId) => {
                      if (!canReorderChores || reorderBusy) {
                        return;
                      }
                      setDraggingChoreId(choreId);
                      setDragOverChoreId("");
                      setDropIndicator(null);
                    }}
                    onDragOver={(choreId, position) => {
                      if (!canReorderChores || reorderBusy || !draggingChoreId) {
                        return;
                      }
                      setDragOverChoreId(choreId);
                      setDropIndicator((current) => {
                        if (
                          current &&
                          current.choreId === choreId &&
                          current.position === position
                        ) {
                          return current;
                        }
                        return { choreId, position };
                      });
                    }}
                    onDrop={onDropReorder}
                    onDragEnd={() => {
                      setDragOverChoreId("");
                      setDraggingChoreId("");
                      setDropIndicator(null);
                    }}
                    onEdited={onReload}
                  />
                ))}
              </ul>
              {visibleChorePage.hasMore ? (
                <Button
                  type="button"
                  className="btn btn-secondary today-chores-load-more"
                  onClick={() => setVisibleChoreCount((current) => current + CHORE_PAGE_SIZE)}>
                  {t("dashboard.loadMore")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <aside className="completion-chart">
          <div className="completion-chart-header">
            <h3 className="m-0 inline-flex h-10 items-center text-[0.88rem] leading-none font-semibold text-[var(--muted)]">
              {t("dashboard.completedChores")}
            </h3>
            <TailwindSelect
              ariaLabel={t("dashboard.completionRange")}
              value={completionWindow}
              onChange={updateCompletionWindow}
              options={completionWindowOptions}
              className="completion-chart-window-select"
            />
          </div>
          {completionLoading ? <p className="small">{t("dashboard.loadingChart")}</p> : null}
          {!completionLoading && completionError ? <Alert>{t("dashboard.chartLoadError", { error: completionError })}</Alert> : null}
          {!completionLoading && !completionError ? (
            <>
              <ul className="completion-chart-list">
                {completionCounts.map((entry, index) => {
                  const widthPercent = Math.max(0, Math.min(100, (entry.count / completionMax) * 100));
                  const avatarPrimaryColor = getSafeHexColor(entry.color);
                  const style = {
                    "--bar-width": `${widthPercent}%`,
                    "--bar-delay": `${index * 60}ms`,
                    "--bar-color": entry.color || COMPLETION_LINE_COLORS[index % COMPLETION_LINE_COLORS.length],
                  } as CSSProperties;
                  const rowParams = new URLSearchParams(completionRowBaseParams);
                  rowParams.set("assigneeId", entry.memberId);
                  const rowHref = `/chores?${rowParams.toString()}`;
                  return (
                    <li key={entry.memberId}>
                      <Link
                        href={rowHref}
                        className="completion-chart-row completion-chart-row-link"
                        onMouseEnter={() => {
                          setHoveredCompletionRowMemberId((current) =>
                            current === entry.memberId ? current : entry.memberId,
                          );
                        }}
                        onMouseLeave={() => {
                          setHoveredCompletionRowMemberId((current) =>
                            current === null ? current : null,
                          );
                        }}
                        onFocus={() => {
                          setHoveredCompletionRowMemberId((current) =>
                            current === entry.memberId ? current : entry.memberId,
                          );
                        }}
                        onBlur={() => {
                          setHoveredCompletionRowMemberId((current) =>
                            current === null ? current : null,
                          );
                        }}
                          aria-label={`${t("dashboard.completedChores")}: ${entry.name}`}>
                        <FamilyMemberAvatar
                          className="completion-chart-avatar"
                          size={32}
                          borderWidth={1}
                          name={entry.name}
                          avatarId={entry.avatarId}
                          avatarPhotoUrl={entry.avatarPhotoUrl}
                          primaryColor={avatarPrimaryColor || undefined}
                        />
                        <div className="completion-chart-content">
                          <div className="completion-chart-meta">
                            <span>{entry.name}</span>
                            <strong>{entry.count}</strong>
                          </div>
                          <div className="completion-chart-track">
                            <span className="completion-chart-bar" style={style} />
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <section className="lifetime-chart-section">
                {completionSeries.series.length > 0 &&
                completionSeries.labels.length > 0 &&
                completionTrendHasData ? (
                  <>
                    <div className="lifetime-chart-shell">
                      <div className="h-64 w-full">
                        <Line
                          data={completionTrendLineData}
                          options={completionTrendLineOptions}
                          plugins={[completionLineGlowPlugin]}
                          aria-label={t("dashboard.completedTrendAria")}
                          role="img"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="small">{t("dashboard.noCompletedChores")}</p>
                )}
              </section>
            </>
          ) : null}
        </aside>
      </div>
      <ModalShell
        open={Boolean(pendingApproveChore)}
        onRequestClose={() => {
          setPendingApproveChore(null);
          setApprovalSelectionsByAssignee({});
        }}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingApproveChore ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">{t("dashboard.completeApproveTitle")}</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => {
                    setPendingApproveChore(null);
                    setApprovalSelectionsByAssignee({});
                  }}
                  aria-label={t("common.actions.close")}
                  title={t("common.actions.close")}>
                  X
                </Button>
              </div>
              <p className="mb-3 text-sm text-slate-600">
                <strong>{pendingApproveChore.title}</strong> {t("dashboard.totalCoins")}{" "}
                <strong>{pendingApproveChore.coinValue}</strong>
              </p>
              <div className="mb-4 flex flex-col gap-2">
                {pendingApprovalAssigneeIds.map((assigneeId) => {
                  const member = memberByAlias.get(assigneeId);
                  const selection = approvalSelectionsByAssignee[assigneeId] ?? {
                    enabled: true,
                    coinValue: 0,
                  };
                  return (
                    <div
                      key={assigneeId}
                      role="button"
                      tabIndex={0}
                      className={`approval-assignee-row${selection.enabled ? "" : " is-disabled"}`}
                      onClick={() =>
                        setApprovalSelectionsByAssignee((current) =>
                          toggleApprovalAssigneeSelection(
                            current,
                            pendingApprovalAssigneeIds,
                            assigneeId,
                            pendingApproveChore.coinValue ?? 0,
                          ),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }
                        event.preventDefault();
                        setApprovalSelectionsByAssignee((current) =>
                          toggleApprovalAssigneeSelection(
                            current,
                            pendingApprovalAssigneeIds,
                            assigneeId,
                            pendingApproveChore.coinValue ?? 0,
                          ),
                        );
                      }}>
                      <span className="inline-flex min-w-0 items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={selection.enabled}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                          className="approval-assignee-checkbox"
                        />
                        <FamilyMemberAvatar
                          className={selection.enabled ? undefined : "approval-assignee-avatar-disabled"}
                          size={28}
                          borderWidth={1}
                          name={member?.name || t("dashboard.familyMemberFallback")}
                          avatarId={member?.avatarId || undefined}
                          avatarPhotoUrl={member?.avatarPhotoUrl || undefined}
                        />
                        <span className={`approval-assignee-name${selection.enabled ? "" : " is-disabled"}`}>
                          {member?.name || assigneeId}
                        </span>
                      </span>
                      <span
                        className="relative inline-flex items-center"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}>
                        <span className="pointer-events-none absolute left-2 inline-flex items-center text-amber-500">
                          <CoinIcon size={14} />
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          disabled={!selection.enabled}
                          value={selection.enabled ? selection.coinValue : 0}
                          onChange={(event) =>
                            setApprovalSelectionsByAssignee((current) =>
                              updateApprovalAssigneeCoins(current, assigneeId, Number(event.target.value) || 0),
                            )
                          }
                          className={`h-9 w-24 rounded-md border py-1 pr-2 pl-7 text-right text-slate-800${
                            selection.enabled
                              ? " border-slate-300 bg-white"
                              : " cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          }`}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(busyActionsById[pendingApproveChore.id])}
                  onClick={() => {
                    setPendingApproveChore(null);
                    setApprovalSelectionsByAssignee({});
                  }}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busyActionsById[pendingApproveChore.id])}
                  onClick={() => void onCompleteAndApproveFromDashboard()}>
                  {busyActionsById[pendingApproveChore.id] === "complete"
                    ? t("family.memberLanguageSaving")
                    : t("dashboard.completeAndApprove")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </article>
  );
}



