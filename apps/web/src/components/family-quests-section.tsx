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
    <section className="family-page-card family-quests-card" aria-label="Family quests">
      <div className="family-categories-card-header">
        <div className="family-categories-card-title">
          <h2>Family Quests</h2>
          <p className="small">
            {quests.length}/{payload?.maxQuests ?? 3} custom quest{quests.length === 1 ? "" : "s"}
          </p>
        </div>
        {canCreate ? (
          <Link href="/family/quests/new" className="btn btn-secondary">
            Create Quest
          </Link>
        ) : null}
      </div>
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
        <div className="family-quests-empty">
          <p className="small">No family quests yet.</p>
          {canCreate ? (
            <Button type="button" className="btn btn-primary" onClick={() => { window.location.href = "/family/quests/new"; }}>
              Create the first quest
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
