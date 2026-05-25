"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type FamilyQuestSummary = {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  coverImage: string;
  summary: string;
  status: "draft" | "published";
  score: number;
  issueCount: number;
  updatedAt: string;
};

type FamilyQuestsResponse = {
  noFamily: boolean;
  quests: FamilyQuestSummary[];
  viewerRole: "admin" | "player";
  maxQuests: number;
};

export function FamilyQuestsSection() {
  const [payload, setPayload] = useState<FamilyQuestsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/family/quests", { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP_${response.status}`);
        }
        const nextPayload = (await response.json()) as FamilyQuestsResponse;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "family_quests_unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const quests = payload?.quests ?? [];
  const canCreate = payload?.viewerRole === "admin" && quests.length < (payload?.maxQuests ?? 3);

  return (
    <section aria-label="Family quests">
      {error ? <Alert>Could not load family quests: {error}</Alert> : null}
      {loading ? (
        <div className="quests-netflix-rail quests-netflix-rail-skeleton" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <article key={index} className="quests-netflix-tile">
              <div className="quests-netflix-tile-image quests-skeleton-block" />
              <span className="quests-netflix-tile-meta">
                <span className="quests-skeleton-line quests-skeleton-line-title" />
                <span className="quests-skeleton-line quests-skeleton-line-body quests-skeleton-line-short" />
              </span>
            </article>
          ))}
        </div>
      ) : quests.length > 0 ? (
        <div className="quests-netflix-rail family-quests-rail">
          {quests.map((quest) => (
            <Link key={quest.id} href={`/family/quests/${encodeURIComponent(quest.id)}`} className="quests-netflix-tile">
              <img
                src={quest.coverImage || "/assets/quests/template/images/cover-placeholder.png"}
                alt={quest.title}
                className="quests-netflix-tile-image"
                onError={(event) => {
                  event.currentTarget.src = "/assets/quests/template/images/cover-placeholder.png";
                }}
              />
              <span className="quests-netflix-tile-meta">
                <strong>{quest.title}</strong>
                <span className="small">
                  {quest.status} &bull; score {quest.score}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Alert tone="info" role="status" className="family-awards-info-card">
          <div className="grid gap-1">
            <strong>Family quests turn bigger goals into guided adventures.</strong>
            <span>
              Parents create quests for kids to play through, complete choices, and earn rewards tied to family goals.
              Quests live here for editing and review, appear for players when they are ready to play, and work best
              when you want a multi-step challenge instead of a single chore or award.
            </span>
          </div>
        </Alert>
      )}
      {canCreate ? (
        <div className="mt-4 flex justify-center">
          <Link href="/family/quests/new" className="btn btn-primary">
            Add Quest
          </Link>
        </div>
      ) : null}
    </section>
  );
}
