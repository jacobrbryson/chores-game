"use client";

import { AddEditChoresDialog, type AddEditChoreSavedResult } from "@/components/add-edit-chores-dialog";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
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
import type { FamilySnapshotChore } from "@/lib/family/types";
import {
  parseCompletionWindow,
  type CompletionWindow,
} from "@/lib/preferences/completion-window";
import { triggerPartyConfetti } from "@/lib/confetti/party";

type TodayChoresPanelProps = {
  chores: FamilySnapshotChore[];
  viewerAssigneeIds: string[];
  viewerRole: "admin" | "player";  onReload: () => Promise<void> | void;
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

type CompletionStatsResponse = {
  window: CompletionWindow;
  counts: CompletionCount[];
  trend?: CompletionSeries;
};

function normalizeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

const MY_CHORES_ONLY_STORAGE_KEY = "today_chores_my_only";
const COMPLETION_WINDOW_STORAGE_KEY = "today_chores_completion_window";
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
  viewerAssigneeIds,
  viewerRole,  onReload,
}: TodayChoresPanelProps) {
  const canCreateChores = viewerRole === "admin";
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
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
  }, [completionWindow, completionStatsRefreshTick]);

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

  const viewerAssigneeIdSet = useMemo(() => new Set(viewerAssigneeIds), [viewerAssigneeIds]);
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
  const pendingCreateChoreIdSet = useMemo(
    () => new Set(Object.values(pendingCreateChoresByRequestId).map((chore) => chore.id)),
    [pendingCreateChoresByRequestId],
  );
  const myChoreCount = useMemo(
    () =>
      openChores.filter(
        (chore) => chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId),
      ).length,
    [openChores, viewerAssigneeIdSet],
  );
  const visibleChores = useMemo(() => {
    if (!myChoresOnly) {
      return openChores;
    }
    return openChores.filter(
      (chore) => chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId),
    );
  }, [openChores, myChoresOnly, viewerAssigneeIdSet]);
  const hasBusyChoreAction = Object.keys(busyActionsById).length > 0;
  const hasPendingCreates = Object.keys(pendingCreateChoresByRequestId).length > 0;
  const hasPendingDeletes = Object.keys(pendingDeleteChoreIds).length > 0;
  const canReorderChores =
    viewerRole === "admin" &&
    !hasBusyChoreAction &&
    !hasPendingCreates &&
    !hasPendingDeletes;
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
            coinValue: 10,
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
    if (busyActionsById[choreId]) {
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
                <span className="today-chores-toggle-count">
                  {" "}
                  ({myChoreCount}) out of ({openChores.length})
                </span>
              </span>
            </label>
            <div className="today-chores-actions-shell today-chores-actions-desktop">
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
          {choreActionError ? (
            <p className="small family-error mb-3">Chore update failed: {choreActionError}</p>
          ) : null}
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
                    chore={chore}                    canManageActions={
                      viewerRole === "admin" && !pendingCreateChoreIdSet.has(chore.id)
                    }
                    canComplete={
                      !pendingCreateChoreIdSet.has(chore.id) &&
                      (viewerRole === "admin" ||
                        Boolean(chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId)))
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
          {!completionLoading && completionError ? (
            <p className="small family-error">Could not load chart: {completionError}</p>
          ) : null}
          {!completionLoading && !completionError ? (
            <>
              <ul className="completion-chart-list">
                {completionCounts.map((entry, index) => {
                  const widthPercent = Math.max(0, Math.min(100, (entry.count / completionMax) * 100));
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
                        <Avatar
                          className="completion-chart-avatar"
                          size={32}
                          borderWidth={1}
                          name={entry.name}
                          avatarId={entry.avatarId}
                          photoUrl={entry.avatarPhotoUrl}
                          referrerPolicy="no-referrer"
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
    </article>
  );
}





