"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { AchievementCard } from "@/components/achievements/achievement-card";
import { fetchAchievements, readAchievementHighlightId } from "@/lib/achievements/api";
import type { AchievementResponseItem } from "@/lib/achievements/service";

type AudienceFilter = "all" | "player" | "admin";
const HIDE_COMPLETE_STORAGE_KEY = "achievementsHideComplete";

export function AchievementsPageClient() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<AchievementResponseItem[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [highlightedId, setHighlightedId] = useState("");
  const [adminFilter, setAdminFilter] = useState<AudienceFilter>("all");
  const [hideComplete, setHideComplete] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const load = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const payload = await fetchAchievements();
      setItems(payload.achievements);
      setViewerRole(payload.viewerRole);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "achievements_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(HIDE_COMPLETE_STORAGE_KEY);
      if (storedValue === "true") {
        setHideComplete(true);
      } else if (storedValue === "false") {
        setHideComplete(false);
      }
    } catch {
      // Ignore storage access errors and keep in-memory behavior.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDE_COMPLETE_STORAGE_KEY, hideComplete ? "true" : "false");
    } catch {
      // Ignore storage write errors.
    }
  }, [hideComplete]);

  useEffect(() => {
    const highlightId = readAchievementHighlightId(searchParams.toString(), window.location.hash);
    if (!highlightId) {
      return;
    }
    const node = cardRefs.current.get(highlightId);
    if (!node) {
      return;
    }
    setHighlightedId(highlightId);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => setHighlightedId(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [items, searchParams]);

  const orderedItems = useMemo(() => {
    let filtered = [...items];
    if (viewerRole === "player") {
      filtered = filtered.filter((item) => item.audience === "player");
    }
    if (viewerRole === "admin" && adminFilter !== "all") {
      filtered = filtered.filter((item) => item.audience === adminFilter);
    }
    if (hideComplete) {
      filtered = filtered.filter((item) => !item.completed);
    }

    return filtered.sort((a, b) => {
      if (b.percentComplete !== a.percentComplete) {
        return b.percentComplete - a.percentComplete;
      }
      if (viewerRole === "player" && a.audience !== b.audience) {
        return a.audience === "player" ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder;
    });
  }, [adminFilter, hideComplete, items, viewerRole]);

  const totals = useMemo(() => {
    const visibleItems =
      viewerRole === "player" ? items.filter((item) => item.audience === "player") : items;
    const completedCount = visibleItems.filter((item) => item.completed).length;
    return {
      total: visibleItems.length,
      completed: completedCount,
    };
  }, [items, viewerRole]);

  return (
    <section className="space-y-4">
      {!isLoading ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="family-category-chip">Total: {totals.total}</span>
          <span className="family-category-chip">Completed: {totals.completed}</span>
        </div>
      ) : null}
      <div className="achievements-toolbar flex flex-wrap gap-2">
        {viewerRole === "admin" ? (
          <>
            <Button
              className={`btn btn-secondary ${adminFilter === "all" ? "ring-2 ring-sky-300" : ""}`}
              onClick={() => setAdminFilter("all")}>
              All
            </Button>
            <Button
              className={`btn btn-secondary ${adminFilter === "player" ? "ring-2 ring-sky-300" : ""}`}
              onClick={() => setAdminFilter("player")}>
              Player
            </Button>
            <Button
              className={`btn btn-secondary ${adminFilter === "admin" ? "ring-2 ring-sky-300" : ""}`}
              onClick={() => setAdminFilter("admin")}>
              Admin
            </Button>
          </>
        ) : null}
        <label className="today-chores-toggle-row">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={hideComplete}
            onChange={(event) => setHideComplete(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className="my-chores-toggle-track"
          />
          <span className="small today-chores-toggle-copy">
            <span>Hide Complete</span>
          </span>
        </label>
      </div>
      {isLoading ? (
        <section aria-label="Loading achievements" aria-hidden="true" className="space-y-3">
          <div className="achievements-toolbar flex flex-wrap gap-2">
            <div className="family-skeleton family-skeleton-chip" />
            <div className="family-skeleton family-skeleton-chip" />
            <div className="family-skeleton family-skeleton-chip" />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="family-skeleton h-16 w-16 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="family-skeleton family-skeleton-title" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                </div>
              </div>
              <div className="family-skeleton family-skeleton-row mt-3" />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="family-skeleton h-16 w-16 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="family-skeleton family-skeleton-title" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                </div>
              </div>
              <div className="family-skeleton family-skeleton-row mt-3" />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="family-skeleton h-16 w-16 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="family-skeleton family-skeleton-title" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                </div>
              </div>
              <div className="family-skeleton family-skeleton-row mt-3" />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="family-skeleton h-16 w-16 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="family-skeleton family-skeleton-title" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                  <div className="family-skeleton family-skeleton-subtitle" />
                </div>
              </div>
              <div className="family-skeleton family-skeleton-row mt-3" />
            </article>
          </div>
        </section>
      ) : null}
      {!isLoading && error ? <Alert>Could not load achievements: {error}</Alert> : null}
      {!isLoading && !error ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {orderedItems.map((achievement) => (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              highlighted={highlightedId === achievement.id}
              cardRef={(node) => {
                if (node) {
                  cardRefs.current.set(achievement.id, node);
                } else {
                  cardRefs.current.delete(achievement.id);
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
