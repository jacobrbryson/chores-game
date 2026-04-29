"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type QuestLibraryEntry = {
  questId: string;
  title: string;
  subtitle: string;
  author: string;
  coverImage: string;
  summary: string;
  ageRange: string;
  estimatedMinutes: number;
  difficulty: string;
  completionStatus: "not_started" | "in_progress" | "completed";
  endingsDiscovered: number;
  totalEndings: number;
  bestEndingId: string;
  actionLabel: "Start" | "Continue" | "Replay";
};

export function QuestsLibraryClient() {
  const [quests, setQuests] = useState<QuestLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/quests", { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? `QUESTS_HTTP_${response.status}`);
        }
        const payload = (await response.json()) as { quests?: QuestLibraryEntry[] };
        if (!cancelled) {
          setQuests(payload.quests ?? []);
        }
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "quests_unavailable");
          setQuests([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return <p className="small">Loading quests...</p>;
  }

  if (error) {
    return <Alert>Could not load quests: {error}</Alert>;
  }

  return (
    <section className="quests-library-grid">
      {quests.map((quest) => (
        <article key={quest.questId} className="quests-library-card">
          <img
            src={quest.coverImage || "/assets/quests/template/images/cover-placeholder.png"}
            alt={quest.title}
            className="quests-library-cover"
            onError={(event) => {
              event.currentTarget.src = "/assets/quests/template/images/cover-placeholder.png";
            }}
          />
          <div className="quests-library-copy">
            <h2>{quest.title}</h2>
            <p className="small quests-library-subtitle">{quest.subtitle}</p>
            <p className="small">By {quest.author}</p>
            <p>{quest.summary}</p>
            <p className="small">
              Ages {quest.ageRange} • {quest.estimatedMinutes} min • {quest.difficulty}
            </p>
            <p className="small">
              Status: {quest.completionStatus.replace("_", " ")} • Endings: {quest.endingsDiscovered}/{quest.totalEndings}
              {quest.bestEndingId ? ` • Best ending: ${quest.bestEndingId}` : ""}
            </p>
            <Link href={`/quests/${encodeURIComponent(quest.questId)}`}>
              <Button type="button" className="btn btn-primary">
                {quest.actionLabel}
              </Button>
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
