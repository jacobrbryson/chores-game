"use client";

import { AddEditChoresDialog, type AddEditChoreSavedResult } from "@/components/add-edit-chores-dialog";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { MenuActionButton } from "@/components/menu-action-button";
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
import type { FamilySnapshotChore, FamilySnapshotMember } from "@/lib/family/types";
import {
  parseCompletionWindow,
  type CompletionWindow,
} from "@/lib/preferences/completion-window";
import { triggerPartyConfetti } from "@/lib/confetti/party";

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

function normalizeChoreTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const MY_CHORES_ONLY_STORAGE_KEY = "today_chores_my_only";
const COMPLETION_WINDOW_STORAGE_KEY = "today_chores_completion_window";
const QUICK_SORT_STORAGE_KEY = "today_chores_quick_sort";
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
const COMPLETION_WINDOW_OPTIONS: TailwindSelectOption<CompletionWindow>[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];
const CHORE_EXIT_ANIMATION_MS = 160;
const QUICK_SORT_DEFAULT_DIRECTION: Record<QuickSortKey, QuickSortDirection> = {
  coin_value: "desc",
  frequency: "desc",
  alphabetical: "asc",
};
const QUICK_SORT_KEYS: QuickSortKey[] = ["coin_value", "frequency", "alphabetical"];
const QUICK_SORT_DIRECTIONS: QuickSortDirection[] = ["asc", "desc"];


ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
);

function readMyChoresOnly() {
  try {
    return window.localStorage.getItem(MY_CHORES_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMyChoresOnly(next: boolean) {
  try {
    window.localStorage.setItem(MY_CHORES_ONLY_STORAGE_KEY, next ? "1" : "0");
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
  const canCreateChores = viewerRole === "admin";
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [desktopQuickSortMenuOpen, setDesktopQuickSortMenuOpen] = useState(false);
  const [mobileQuickSortMenuOpen, setMobileQuickSortMenuOpen] = useState(false);
  const [quickSortState, setQuickSortState] = useState<QuickSortState | null>(readQuickSortState);
  const [mobileAddDialogOpen, setMobileAddDialogOpen] = useState(false);
  const [busyActionsById, setBusyActionsById] = useState<Record<string, "delete" | "complete">>({});
  const [exitingChoreIds, setExitingChoreIds] = useState<Record<string, true>>({});
  const [optimisticallyCompletedIds, setOptimisticallyCompletedIds] = useState<Record<string, true>>({});
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<Record<string, true>>({});
  const [pendingDeleteChoreIds, setPendingDeleteChoreIds] = useState<Record<string, true>>({});
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
  const [approvalCoinsByAssignee, setApprovalCoinsByAssignee] = useState<Record<string, number>>({});
  const [myChoresOnly, setMyChoresOnly] = useState(readMyChoresOnly);
  const [completionWindow, setCompletionWindow] = useState<CompletionWindow>(readCompletionWindow);
  const [completionCounts, setCompletionCounts] = useState<CompletionCount[]>([]);
  const [completionSeries, setCompletionSeries] =
    useState<CompletionSeries>(EMPTY_COMPLETION_SERIES);
  const [completionLoading, setCompletionLoading] = useState(true);
  const [completionError, setCompletionError] = useState("");
  const [hoveredCompletionRowMemberId, setHoveredCompletionRowMemberId] = useState<string | null>(null);
  const [hoveredCompletionChartMemberId, setHoveredCompletionChartMemberId] = useState<string | null>(null);
  const [completionStatsRefreshTick, setCompletionStatsRefreshTick] = useState(0);
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const completionHideTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});


  useEffect(() => {
    let cancelled = false;
    async function loadPreference() {
      try {
        const response = await fetch("/api/preferences", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          myChoresOnly?: boolean;
          completionWindow?: CompletionWindow | null;
        };
        if (cancelled) {
          return;
        }
        if (typeof payload.myChoresOnly === "boolean") {
          setMyChoresOnly(payload.myChoresOnly);
          writeMyChoresOnly(payload.myChoresOnly);
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
    setPendingDeleteChoreIds((current) => {
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
    if (!mobileActionsOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (mobileActionsRef.current?.contains(target)) {
        return;
      }
      setMobileActionsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [mobileActionsOpen]);

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
  const pendingCreateChoreIdSet = useMemo(
    () => new Set(Object.values(pendingCreateChoresByRequestId).map((chore) => chore.id)),
    [pendingCreateChoresByRequestId],
  );
  const visibleChores = useMemo(() => {
    if (!myChoresOnly) {
      return sortedOpenChores;
    }
    return sortedOpenChores.filter(
      (chore) =>
        (chore.assigneeIds ?? []).some((id) => viewerAssigneeIdSet.has(normalizeAssigneeAlias(id))) ||
        Boolean(chore.assigneeId && viewerAssigneeIdSet.has(normalizeAssigneeAlias(chore.assigneeId))),
    );
  }, [sortedOpenChores, myChoresOnly, viewerAssigneeIdSet]);
  const hasBusyChoreAction = Object.keys(busyActionsById).length > 0;
  const hasPendingCreates = Object.keys(pendingCreateChoresByRequestId).length > 0;
  const hasPendingDeletes = Object.keys(pendingDeleteChoreIds).length > 0;
  const canReorderChores =
    viewerRole === "admin" &&
    !hasBusyChoreAction &&
    !hasPendingCreates &&
    !hasPendingDeletes &&
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

  function updateMyChoresOnly(next: boolean) {
    setMyChoresOnly(next);
    writeMyChoresOnly(next);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myChoresOnly: next }),
    }).catch(() => {
      // Keep local value; retry will happen on next toggle.
    });
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
    setDesktopQuickSortMenuOpen(false);
    setMobileQuickSortMenuOpen(false);
  }

  function onDesktopQuickSortMenuOpenChange(next: boolean) {
    setDesktopQuickSortMenuOpen(next);
    if (next) {
      setMobileQuickSortMenuOpen(false);
    }
  }

  function onMobileQuickSortMenuOpenChange(next: boolean) {
    setMobileQuickSortMenuOpen(next);
    if (next) {
      setDesktopQuickSortMenuOpen(false);
      setMobileActionsOpen(false);
    }
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
      return;
    }

    if (result.phase === "error") {
      setChoreActionError(result.error || "update_chore_failed");
      return;
    }
    if (result.phase === "success") {
      await onReload();
    }
  }

  async function onDeleteChore(choreId: string) {
    if (busyActionsById[choreId]) {
      return;
    }
    setChoreActionError("");
    setBusyActionsById((current) => ({ ...current, [choreId]: "delete" }));
    setPendingDeleteChoreIds((current) => ({ ...current, [choreId]: true }));
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      setPendingDeleteChoreIds((current) => {
        const next = { ...current };
        delete next[choreId];
        return next;
      });
      setExitingChoreIds((current) => ({ ...current, [choreId]: true }));
      await new Promise((resolve) => setTimeout(resolve, CHORE_EXIT_ANIMATION_MS));
      setOptimisticallyRemovedIds((current) => ({ ...current, [choreId]: true }));
      await onReload();
    } catch (removeError) {
      setChoreActionError(normalizeError(removeError, "remove_chore_failed"));
      setPendingDeleteChoreIds((current) => {
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
    if (viewerRole === "admin" && chore && isMultiOrFamily) {
      const assigneeIds = chore.assigneeScope === "family"
        ? members.filter((member) => member.status === "active").map((member) => member.id)
        : chore.assigneeIds ?? [];
      const defaultCoins =
        assigneeIds.length > 0 ? Math.ceil((chore.coinValue ?? 0) / assigneeIds.length) : chore.coinValue ?? 0;
      const nextCoins: Record<string, number> = {};
      for (const assigneeId of assigneeIds) {
        nextCoins[assigneeId] = defaultCoins;
      }
      setApprovalCoinsByAssignee(nextCoins);
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
      setCompletionStatsRefreshTick((current) => current + 1);
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
        body: JSON.stringify({ action: "complete" }),
      });
      if (!completeResponse.ok) {
        const body = (await completeResponse.json()) as { error?: string };
        throw new Error(body.error ?? `COMPLETE_CHORE_HTTP_${completeResponse.status}`);
      }

      const approveResponse = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          approvalPayouts: Object.entries(approvalCoinsByAssignee).map(([assigneeId, coinValue]) => ({
            assigneeId,
            coinValue: Math.max(0, Math.trunc(Number(coinValue) || 0)),
          })),
        }),
      });
      if (!approveResponse.ok) {
        const body = (await approveResponse.json()) as { error?: string };
        throw new Error(body.error ?? `APPROVE_CHORE_HTTP_${approveResponse.status}`);
      }
      setPendingApproveChore(null);
      setApprovalCoinsByAssignee({});
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

  const completionRowBaseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", "completed");
    params.set("completedWindow", completionWindow);
    params.set("tzOffsetMinutes", String(new Date().getTimezoneOffset()));
    return params;
  }, [completionWindow]);

  return (
    <article className="family-panel">
      <div className="today-chores-layout">
        <div className="today-chores-main">
          <div className="today-chores-toolbar">
            <label className="today-chores-toggle-row">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={myChoresOnly}
                onChange={(event) => updateMyChoresOnly(event.target.checked)}
              />
              <span
                aria-hidden="true"
                className="my-chores-toggle-track"
              />
              <span className="small today-chores-toggle-copy">
                <span>My Chores</span>
              </span>
            </label>
            <div className="today-chores-actions-shell today-chores-actions-desktop">
              <AppMenu
                open={desktopQuickSortMenuOpen}
                onOpenChange={onDesktopQuickSortMenuOpenChange}
                wrapperClassName="today-chores-sort-menu-wrap"
                triggerClassName={`today-chores-action-link today-chores-action-link-divider today-chores-action-sort-trigger${
                  quickSortState ? " today-chores-action-sort-trigger-active" : ""
                }`}
                triggerTitle="Quick Sorting Options"
                triggerAriaLabel="Quick sorting options"
                panelClassName="app-menu-panel profile-dropdown today-chores-sort-menu"
                trigger={
                  <span className="today-chores-sort-icon" aria-hidden="true">
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-a" />
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-b" />
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-c" />
                  </span>
                }>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("coin_value")}
                  trailing={
                    quickSortState?.key === "coin_value"
                      ? quickSortDirectionLabel("coin_value", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Coin Value
                </MenuActionButton>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("frequency")}
                  trailing={
                    quickSortState?.key === "frequency"
                      ? quickSortDirectionLabel("frequency", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Frequency
                </MenuActionButton>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("alphabetical")}
                  trailing={
                    quickSortState?.key === "alphabetical"
                      ? quickSortDirectionLabel("alphabetical", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Alphabetical
                </MenuActionButton>
              </AppMenu>
              <Link
                href="/chores"
                className={`today-chores-action-link ${
                  canCreateChores ? "today-chores-action-link-divider" : ""
                }`}>
                View all chores
              </Link>
              {canCreateChores ? (
                <AddEditChoresDialog
                  renderTrigger={(openDialog) => (
                    <Button
                      type="button"
                      title="Add more chores"
                      aria-label="Add more chores"
                      className="today-chores-action-add"
                      onClick={openDialog}>
                      +
                    </Button>
                  )}
                  onSaved={onChoreSaved}
                />
              ) : null}
            </div>
            <div className="today-chores-actions-mobile" ref={mobileActionsRef}>
              <AppMenu
                open={mobileQuickSortMenuOpen}
                onOpenChange={onMobileQuickSortMenuOpenChange}
                wrapperClassName="today-chores-sort-menu-wrap"
                triggerClassName={`today-chores-actions-mobile-trigger today-chores-actions-mobile-sort-trigger${
                  quickSortState ? " today-chores-action-sort-trigger-active" : ""
                }`}
                triggerTitle="Quick Sorting Options"
                triggerAriaLabel="Quick sorting options"
                panelClassName="app-menu-panel profile-dropdown today-chores-sort-menu"
                trigger={
                  <span className="today-chores-sort-icon" aria-hidden="true">
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-a" />
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-b" />
                    <span className="today-chores-sort-icon-bar today-chores-sort-icon-bar-c" />
                  </span>
                }>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("coin_value")}
                  trailing={
                    quickSortState?.key === "coin_value"
                      ? quickSortDirectionLabel("coin_value", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Coin Value
                </MenuActionButton>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("frequency")}
                  trailing={
                    quickSortState?.key === "frequency"
                      ? quickSortDirectionLabel("frequency", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Frequency
                </MenuActionButton>
                <MenuActionButton
                  fullWidth
                  onClick={() => onSelectQuickSort("alphabetical")}
                  trailing={
                    quickSortState?.key === "alphabetical"
                      ? quickSortDirectionLabel("alphabetical", quickSortState.direction)
                      : null
                  }
                  trailingClassName="today-chores-sort-menu-direction">
                  Alphabetical
                </MenuActionButton>
              </AppMenu>
              <Button
                type="button"
                aria-label="Chores actions"
                aria-expanded={mobileActionsOpen}
                className="today-chores-actions-mobile-trigger"
                onClick={() => setMobileActionsOpen((current) => !current)}>
                <span className="today-chores-kebab" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </Button>
              {mobileActionsOpen ? (
                <div className="today-chores-actions-mobile-menu">
                  {canCreateChores ? (
                    <Button
                      type="button"
                      className="today-chores-mobile-menu-item"
                      onClick={() => {
                        setMobileActionsOpen(false);
                        setMobileAddDialogOpen(true);
                      }}>
                      Add Chore
                    </Button>
                  ) : null}
                  <Link
                    href="/chores"
                    className="today-chores-mobile-menu-item"
                    onClick={() => setMobileActionsOpen(false)}>
                    View All Chores
                  </Link>
                </div>
              ) : null}
              {canCreateChores ? (
                <AddEditChoresDialog
                  hideTrigger
                  open={mobileAddDialogOpen}
                  onOpenChange={setMobileAddDialogOpen}
                  onSaved={onChoreSaved}
                />
              ) : null}
            </div>
          </div>
          {choreActionError ? <Alert className="mb-3">Chore update failed: {choreActionError}</Alert> : null}
          {visibleChores.length === 0 ? (
            <div className="flex flex-col gap-3 pt-1">
              <p className="small">
                {myChoresOnly ? "No chores assigned to you right now." : "No open chores right now."}
              </p>
              {canCreateChores ? (
                <div className="chores-empty-cta">
                  <AddEditChoresDialog onSaved={onChoreSaved} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="family-list">
                {visibleChores.map((chore) => (
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
                    isDeletePending={Boolean(pendingDeleteChoreIds[chore.id])}
                    onDelete={onDeleteChore}
                    onComplete={onCompleteChore}
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
            </div>
          )}
        </div>
        <aside className="completion-chart">
          <div className="completion-chart-header">
            <h3 className="m-0 inline-flex h-10 items-center text-[0.88rem] leading-none font-semibold text-[var(--muted)]">
              Completed Chores
            </h3>
            <TailwindSelect
              ariaLabel="Completion range"
              value={completionWindow}
              onChange={updateCompletionWindow}
              options={COMPLETION_WINDOW_OPTIONS}
              className="completion-chart-window-select"
            />
          </div>
          {completionLoading ? <p className="small">Loading chart...</p> : null}
          {!completionLoading && completionError ? <Alert>Could not load chart: {completionError}</Alert> : null}
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
                        aria-label={`View ${entry.name}'s completed chores in this range`}>
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
                          aria-label="Completed chores trend by member for selected range"
                          role="img"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="small">No completed chores yet in this range.</p>
                )}
              </section>
            </>
          ) : null}
        </aside>
      </div>
      <ModalShell
        open={Boolean(pendingApproveChore)}
        onRequestClose={() => setPendingApproveChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingApproveChore ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">Complete and Approve Chore</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingApproveChore(null)}
                  aria-label="Close dialog"
                  title="Close dialog">
                  X
                </Button>
              </div>
              <p className="mb-3 text-sm text-slate-600">
                <strong>{pendingApproveChore.title}</strong> total coins:{" "}
                <strong>{pendingApproveChore.coinValue}</strong>
              </p>
              <div className="mb-4 flex flex-col gap-2">
                {(
                  pendingApproveChore.assigneeScope === "family"
                    ? members.filter((member) => member.status === "active").map((member) => member.id)
                    : pendingApproveChore.assigneeIds ?? []
                ).map((assigneeId) => {
                  const member = memberByAlias.get(assigneeId);
                  return (
                    <label key={assigneeId} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2">
                      <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <FamilyMemberAvatar
                          size={28}
                          borderWidth={1}
                          name={member?.name || "Family member"}
                          avatarId={member?.avatarId || undefined}
                          avatarPhotoUrl={member?.avatarPhotoUrl || undefined}
                        />
                        <span>{member?.name || assigneeId}</span>
                      </span>
                      <span className="relative inline-flex items-center">
                        <span className="pointer-events-none absolute left-2 inline-flex items-center text-amber-500">
                          <CoinIcon size={14} />
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={approvalCoinsByAssignee[assigneeId] ?? 0}
                          onChange={(event) =>
                            setApprovalCoinsByAssignee((current) => ({
                              ...current,
                              [assigneeId]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                            }))
                          }
                          className="h-9 w-24 rounded-md border border-slate-300 py-1 pr-2 pl-7 text-right text-slate-800"
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(busyActionsById[pendingApproveChore.id])}
                  onClick={() => setPendingApproveChore(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busyActionsById[pendingApproveChore.id])}
                  onClick={() => void onCompleteAndApproveFromDashboard()}>
                  {busyActionsById[pendingApproveChore.id] === "complete"
                    ? "Saving..."
                    : "Complete and Approve"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </article>
  );
}





