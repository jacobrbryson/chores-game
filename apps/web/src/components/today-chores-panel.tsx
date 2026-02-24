"use client";

import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { Button } from "@/components/button";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  CategoryScale,
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import Link from "next/link";
import { TodayChoreCard } from "@/components/today-chore-card";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import type { FamilySnapshotChore } from "@/lib/family/types";

type TodayChoresPanelProps = {
  chores: FamilySnapshotChore[];
  viewerAssigneeIds: string[];
  viewerRole: "admin" | "player";
  onReload: () => Promise<void> | void;
};

type ChoreActionState = {
  id: string;
  action: "delete" | "complete";
};

type CompletionWindow = "today" | "week" | "month" | "year";
type CompletionTrendInterval = "hour" | "day" | "week";

type CompletionCount = {
  memberId: string;
  name: string;
  count: number;
  color?: string;
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
const EMPTY_COMPLETION_SERIES: CompletionSeries = {
  interval: "day",
  labels: [],
  maxCount: 0,
  series: [],
};
const COMPLETION_LINE_COLORS = [
  "#1f78d1",
  "#20a987",
  "#de6b48",
  "#6a64cf",
  "#cc4f7a",
  "#9c7f1f",
];
const COMPLETION_WINDOW_OPTIONS: TailwindSelectOption<CompletionWindow>[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

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

export function TodayChoresPanel({
  chores,
  viewerAssigneeIds,
  viewerRole,
  onReload,
}: TodayChoresPanelProps) {
  const canCreateChores = viewerRole === "admin";
  const [choreActionLoading, setChoreActionLoading] = useState<ChoreActionState | null>(
    null,
  );
  const [choreActionError, setChoreActionError] = useState("");
  const [myChoresOnly, setMyChoresOnly] = useState(readMyChoresOnly);
  const [completionWindow, setCompletionWindow] = useState<CompletionWindow>("today");
  const [completionCounts, setCompletionCounts] = useState<CompletionCount[]>([]);
  const [completionSeries, setCompletionSeries] =
    useState<CompletionSeries>(EMPTY_COMPLETION_SERIES);
  const [completionLoading, setCompletionLoading] = useState(true);
  const [completionError, setCompletionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadPreference() {
      try {
        const response = await fetch("/api/preferences", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { myChoresOnly?: boolean };
        if (typeof payload.myChoresOnly !== "boolean" || cancelled) {
          return;
        }
        setMyChoresOnly(payload.myChoresOnly);
        writeMyChoresOnly(payload.myChoresOnly);
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
  }, [completionWindow, chores]);

  const viewerAssigneeIdSet = useMemo(() => new Set(viewerAssigneeIds), [viewerAssigneeIds]);
  const myChoreCount = useMemo(
    () =>
      chores.filter(
        (chore) => chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId),
      ).length,
    [chores, viewerAssigneeIdSet],
  );
  const visibleChores = useMemo(() => {
    if (!myChoresOnly) {
      return chores;
    }
    return chores.filter(
      (chore) => chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId),
    );
  }, [chores, myChoresOnly, viewerAssigneeIdSet]);
  const completionMax = useMemo(
    () => Math.max(1, ...completionCounts.map((entry) => entry.count)),
    [completionCounts],
  );
  const completionTrendHasData = useMemo(
    () => completionSeries.series.some((member) => member.points.some((point) => point > 0)),
    [completionSeries.series],
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
    }),
    [completionSeries.maxCount, completionWindow],
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

  async function onDeleteChore(choreId: string) {
    if (choreActionLoading) {
      return;
    }
    setChoreActionError("");
    setChoreActionLoading({ id: choreId, action: "delete" });
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      await onReload();
    } catch (removeError) {
      setChoreActionError(normalizeError(removeError, "remove_chore_failed"));
    } finally {
      setChoreActionLoading(null);
    }
  }

  async function onCompleteChore(choreId: string) {
    if (choreActionLoading) {
      return;
    }
    setChoreActionError("");
    setChoreActionLoading({ id: choreId, action: "complete" });
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
      await onReload();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    } catch (completeError) {
      setChoreActionError(normalizeError(completeError, "complete_chore_failed"));
    } finally {
      setChoreActionLoading(null);
    }
  }

  return (
    <article className="family-panel">
      <div className="today-chores-layout">
        <div className="today-chores-main">
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-3">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={myChoresOnly}
                onChange={(event) => updateMyChoresOnly(event.target.checked)}
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-11 rounded-full border border-[#b9cde9] bg-[#cfdff4] transition-colors duration-150 peer-checked:border-[#49c6a6] peer-checked:bg-[#72d8bf] before:absolute before:left-[2px] before:top-[2px] before:h-[18px] before:w-[18px] before:rounded-full before:bg-white before:shadow-[0_2px_8px_rgba(30,57,94,0.2)] before:transition-transform before:duration-150 before:content-[''] peer-checked:before:translate-x-[18px]"
              />
              <span className="small leading-none">
                My Chores ({myChoreCount}) out of ({chores.length})
              </span>
            </label>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <Link
                href="/chores"
                className={`inline-flex h-10 items-center bg-[#e7fef8] px-3 text-sm font-semibold text-[#0f6f5e] transition-colors hover:bg-[#d9fbf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  canCreateChores ? "border-r border-[#b7eedd]" : ""
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
                      className="inline-flex h-10 min-w-[44px] items-center justify-center bg-[#e7fef8] px-3 text-lg font-semibold leading-none text-[#0f6f5e] transition-colors hover:bg-[#d9fbf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      onClick={openDialog}>
                      +
                    </Button>
                  )}
                  onSaved={onReload}
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
                  <AddEditChoresDialog onSaved={onReload} />
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
                    canManageActions={viewerRole === "admin"}
                    canComplete={
                      viewerRole === "admin" ||
                      Boolean(chore.assigneeId && viewerAssigneeIdSet.has(chore.assigneeId))
                    }
                    busyAction={
                      choreActionLoading?.id === chore.id ? choreActionLoading.action : ""
                    }
                    disabled={Boolean(choreActionLoading)}
                    onDelete={onDeleteChore}
                    onComplete={onCompleteChore}
                    onEdited={onReload}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
        <aside className="completion-chart">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 text-[0.88rem] leading-none font-normal text-[#456389]">
              Completed Chores
            </h3>
            <TailwindSelect
              ariaLabel="Completion range"
              value={completionWindow}
              onChange={(next) => setCompletionWindow(next)}
              options={COMPLETION_WINDOW_OPTIONS}
              className="w-[140px]"
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
                  return (
                    <li key={entry.memberId} className="completion-chart-row">
                      <div className="completion-chart-meta">
                        <span>{entry.name}</span>
                        <strong>{entry.count}</strong>
                      </div>
                      <div className="completion-chart-track">
                        <span className="completion-chart-bar" style={style} />
                      </div>
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
