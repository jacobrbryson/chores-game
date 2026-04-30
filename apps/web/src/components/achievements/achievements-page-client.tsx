"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { AchievementCard } from "@/components/achievements/achievement-card";
import { fetchAchievements, readAchievementHighlightId } from "@/lib/achievements/api";
import type { AchievementResponseItem } from "@/lib/achievements/service";

type AudienceFilter = "all" | "player" | "admin";

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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
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
      {isLoading ? <p className="small">Loading achievements...</p> : null}
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
