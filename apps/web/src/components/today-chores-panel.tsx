"use client";

import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { Button } from "@/components/button";
import Link from "next/link";
import { TodayChoreCard } from "@/components/today-chore-card";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import type { FamilySnapshotChore } from "@/lib/family/types";

type TodayChoresPanelProps = {
  chores: FamilySnapshotChore[];
  viewerAssigneeIds: string[];
  onReload: () => Promise<void> | void;
};

type ChoreActionState = {
  id: string;
  action: "delete" | "complete";
};

type CompletionWindow = "today" | "week" | "year";

type CompletionCount = {
  memberId: string;
  name: string;
  count: number;
};

type CompletionStatsResponse = {
  window: CompletionWindow;
  counts: CompletionCount[];
};

function normalizeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

const MY_CHORES_ONLY_STORAGE_KEY = "today_chores_my_only";

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

export function TodayChoresPanel({
  chores,
  viewerAssigneeIds,
  onReload,
}: TodayChoresPanelProps) {
  const [choreActionLoading, setChoreActionLoading] = useState<ChoreActionState | null>(
    null,
  );
  const [choreActionError, setChoreActionError] = useState("");
  const [myChoresOnly, setMyChoresOnly] = useState(readMyChoresOnly);
  const [completionWindow, setCompletionWindow] = useState<CompletionWindow>("today");
  const [completionCounts, setCompletionCounts] = useState<CompletionCount[]>([]);
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
        const response = await fetch(
          `/api/chores/completion-stats?window=${completionWindow}`,
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
      } catch (statsError) {
        if (cancelled) {
          return;
        }
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
                className="inline-flex h-10 items-center border-r border-[#b7eedd] bg-[#e7fef8] px-3 text-sm font-semibold text-[#0f6f5e] transition-colors hover:bg-[#d9fbf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                View all chores
              </Link>
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
            </div>
          </div>
          {choreActionError ? (
            <p className="small family-error mb-3">Chore update failed: {choreActionError}</p>
          ) : null}
          {visibleChores.length === 0 ? (
            <div className="flex flex-col gap-3 pt-1">
              <p className="small">
                {myChoresOnly ? "No chores assigned to you today." : "No chores due today."}
              </p>
              <div className="chores-empty-cta">
                <AddEditChoresDialog onSaved={onReload} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="family-list">
                {visibleChores.map((chore) => (
                  <TodayChoreCard
                    key={chore.id}
                    chore={chore}
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
          <div className="completion-chart-head">
            <h3>Completed by Member</h3>
            <label className="completion-window-picker">
              <span className="sr-only">Completion range</span>
              <select
                value={completionWindow}
                onChange={(event) => setCompletionWindow(event.target.value as CompletionWindow)}>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="year">This year</option>
              </select>
            </label>
          </div>
          {completionLoading ? <p className="small">Loading chart...</p> : null}
          {!completionLoading && completionError ? (
            <p className="small family-error">Could not load chart: {completionError}</p>
          ) : null}
          {!completionLoading && !completionError ? (
            <ul className="completion-chart-list">
              {completionCounts.map((entry, index) => {
                const widthPercent = Math.max(0, Math.min(100, (entry.count / completionMax) * 100));
                const style = {
                  "--bar-width": `${widthPercent}%`,
                  "--bar-delay": `${index * 60}ms`,
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
          ) : null}
        </aside>
      </div>
    </article>
  );
}
