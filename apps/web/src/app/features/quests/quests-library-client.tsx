"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "@/components/alert";
import { useLocale } from "@/components/locale-provider";

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
  prizeHighlights?: Array<{
    id: string;
    label: string;
    image?: string;
  }>;
  locked?: boolean;
};

export function QuestsLibraryClient() {
  const { t } = useLocale();
  const [quests, setQuests] = useState<QuestLibraryEntry[]>([]);
  const [hasUnlockedQuestPack, setHasUnlockedQuestPack] = useState(false);
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
        const payload = (await response.json()) as {
          quests?: QuestLibraryEntry[];
          meta?: { hasUnlockedQuestPack?: boolean };
        };
        if (!cancelled) {
          setQuests(payload.quests ?? []);
          setHasUnlockedQuestPack(payload.meta?.hasUnlockedQuestPack === true);
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
    return (
      <section className="quests-netflix quests-netflix-skeleton" aria-label={t("quests.loadingQuest")} aria-busy="true">
        <article className="quests-netflix-hero quests-library-card-skeleton">
          <div className="quests-skeleton-block quests-netflix-hero-skeleton-media" />
          <div className="quests-netflix-hero-overlay">
            <div className="quests-skeleton-line quests-skeleton-line-short" />
            <div className="quests-skeleton-line quests-skeleton-line-title" />
            <div className="quests-skeleton-line quests-skeleton-line-body" />
            <div className="quests-skeleton-line quests-skeleton-line-body quests-skeleton-line-short" />
            <div className="quests-skeleton-line quests-skeleton-line-button quests-netflix-hero-skeleton-cta" />
          </div>
        </article>
        <div className="quests-netflix-row quests-library-card-skeleton">
          <div className="quests-skeleton-line quests-netflix-row-skeleton-title" />
          <div className="quests-netflix-rail quests-netflix-rail-skeleton">
            {Array.from({ length: 5 }).map((_, index) => (
              <article key={`quest-rail-skeleton-${index}`} className="quests-netflix-tile">
                <div className="quests-netflix-tile-image quests-skeleton-block" />
                <span className="quests-netflix-tile-meta">
                  <span className="quests-skeleton-line quests-skeleton-line-title" />
                  <span className="quests-skeleton-line quests-skeleton-line-body quests-skeleton-line-short" />
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return <Alert>{t("quests.loadQuestError", { error })}</Alert>;
  }

  const featuredQuest = quests[0] ?? null;
  const continuingQuests = quests.filter((quest) => quest.completionStatus === "in_progress");
  const completedQuests = quests.filter((quest) => quest.completionStatus === "completed");

  return (
    <section className="quests-netflix">
      {featuredQuest ? (
        <article className="quests-netflix-hero">
          <img
            src={featuredQuest.coverImage || "/assets/quests/template/images/cover-placeholder.png"}
            alt={featuredQuest.title}
            className="quests-netflix-hero-image"
            onError={(event) => {
              event.currentTarget.src = "/assets/quests/template/images/cover-placeholder.png";
            }}
          />
          <div className="quests-netflix-hero-overlay">
            <p className="small">{t("quests.featuredQuest")}</p>
            <h2>{featuredQuest.title}</h2>
            <p>{featuredQuest.summary}</p>
            <p className="small">
              Ages {featuredQuest.ageRange} &bull; {featuredQuest.estimatedMinutes} min &bull; {featuredQuest.difficulty}
            </p>
            <Link href={`/quests/${encodeURIComponent(featuredQuest.questId)}`} className="quests-netflix-hero-cta">
              {featuredQuest.actionLabel} <span aria-hidden="true">&rarr;</span>
            </Link>
            {!hasUnlockedQuestPack ? (
              <p className="small quests-netflix-unlock-note">{t("quests.unlockPackNote")}</p>
            ) : null}
          </div>
        </article>
      ) : null}

      {continuingQuests.length > 0 ? (
        <div className="quests-netflix-row">
          <h3>{t("quests.continueWatching")}</h3>
          <QuestRail>
            {continuingQuests.map((quest) => (
              <QuestTile key={`continue-${quest.questId}`} quest={quest} />
            ))}
          </QuestRail>
        </div>
      ) : null}

      <div className="quests-netflix-row">
        <h3>{hasUnlockedQuestPack ? t("quests.questLibrary") : t("quests.availableNow")}</h3>
        <QuestRail>
          {quests.map((quest) => (
            <QuestTile key={quest.questId} quest={quest} />
          ))}
        </QuestRail>
      </div>

      {completedQuests.length > 0 ? (
        <div className="quests-netflix-row">
          <h3>{t("quests.completed")}</h3>
          <QuestRail>
            {completedQuests.map((quest) => (
              <QuestTile key={`completed-${quest.questId}`} quest={quest} />
            ))}
          </QuestRail>
        </div>
      ) : null}

      {!hasUnlockedQuestPack ? (
        <div className="quests-netflix-row">
          <h3>{t("quests.lockedQuests")}</h3>
          <QuestRail>
            {Array.from({ length: 5 }).map((_, index) => (
              <article key={`locked-${index}`} className="quests-netflix-tile quests-netflix-tile-locked">
                <div className="quests-netflix-tile-image quests-netflix-tile-image-locked" />
                <span className="quests-netflix-tile-meta">
                  <strong>{t("quests.questLabel")} {index + 2}</strong>
                  <span className="small">{t("quests.unlockByProgressingQuestOne")}</span>
                </span>
              </article>
            ))}
          </QuestRail>
        </div>
      ) : null}
    </section>
  );
}

function QuestRail({ children }: { children: ReactNode }) {
  const railRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: "left" | "right") {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const amount = Math.max(220, Math.floor(rail.clientWidth * 0.82));
    rail.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }

  return (
    <div className="quests-netflix-rail-wrap">
      <button
        type="button"
        aria-label="Scroll quests left"
        className="quests-netflix-rail-arrow quests-netflix-rail-arrow-left"
        onClick={() => scrollRail("left")}>
        ‹
      </button>
      <div ref={railRef} className="quests-netflix-rail">
        {children}
      </div>
      <button
        type="button"
        aria-label="Scroll quests right"
        className="quests-netflix-rail-arrow quests-netflix-rail-arrow-right"
        onClick={() => scrollRail("right")}>
        ›
      </button>
    </div>
  );
}

function QuestTile({ quest }: { quest: QuestLibraryEntry }) {
  if (quest.locked) {
    return (
      <article className="quests-netflix-tile quests-netflix-tile-locked" aria-label={`${quest.title} coming soon`}>
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
          <span className="small">Coming Soon!</span>
        </span>
      </article>
    );
  }

  return (
    <Link href={`/quests/${encodeURIComponent(quest.questId)}`} className="quests-netflix-tile">
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
          {quest.completionStatus.replace("_", " ")} &bull; {quest.endingsDiscovered}/{quest.totalEndings}
        </span>
      </span>
    </Link>
  );
}
