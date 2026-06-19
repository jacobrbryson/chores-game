"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import { AthenaThinkingPanel } from "@/components/athena/athena-thinking-panel";
import { AthenaSuggestionReveal } from "@/components/athena/athena-suggestion-reveal";
import { AthenaFallbackState } from "@/components/athena/athena-fallback-state";
import { useReducedMotion } from "@/components/athena/use-reduced-motion";

type AthenaMeta = {
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number | null;
  suggestionType: "repeat" | "next_step" | "skill_building" | "novelty";
  reason: string;
  confidence: number;
  requiresParentReview: boolean;
  safetyNotes: string | null;
  categoryLabel: string | null;
  pillar: string | null;
};

type GhostSuggestion = {
  id: string;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCoinValue: number;
  source: string;
  athena?: AthenaMeta;
};

type SuggestionsResponse = {
  suggestions?: GhostSuggestion[];
  viewerRole?: "admin" | "player";
  eligible?: boolean;
  source?: "athena" | "local";
};

const MAX_EMPTY_STATE_SUGGESTIONS = 3;
/** Even on an instant response, let Athena "think" briefly so it feels intentional. */
const MIN_THINK_MS = 600;

type Phase = "thinking" | "revealing" | "empty" | "failed" | "hidden";

/** Explains WHY a local suggestion is shown, derived from its deterministic source. */
function reasonKey(source: string) {
  if (source === "recent_chore") {
    return "ghost.reasonRecent" as const;
  }
  if (source === "family_history") {
    return "ghost.reasonHistory" as const;
  }
  return "ghost.reasonBuiltin" as const;
}

function difficultyKey(difficulty: AthenaMeta["difficulty"]) {
  if (difficulty === "medium") return "ghost.difficultyMedium" as const;
  if (difficulty === "hard") return "ghost.difficultyHard" as const;
  return "ghost.difficultyEasy" as const;
}

function suggestionTypeKey(type: AthenaMeta["suggestionType"]) {
  if (type === "repeat") return "ghost.typeRepeat" as const;
  if (type === "next_step") return "ghost.typeNextStep" as const;
  if (type === "skill_building") return "ghost.typeSkillBuilding" as const;
  return "ghost.typeNovelty" as const;
}

type GhostChoreEmptyStateSuggestionsProps = {
  /** Selected member to assign the chore to (admin flow); ignored for player see-and-do. */
  assigneeId?: string;
  assigneeName?: string;
  /** Viewer role, so Athena's "thinking" thoughts read correctly before the response arrives. */
  viewerRole?: "admin" | "player";
  /** Called after a suggestion is added so the chore list can refresh. */
  onAdded?: () => Promise<void> | void;
};

/**
 * Smart Ghost Chores empty state with the magical Athena experience.
 *
 * Instead of a spinner, Athena "thinks" about the family (avatar breathing/glowing,
 * thoughts that escalate the longer the wait), then reacts and reveals her ideas one
 * at a time. When the family has Athena connected these come from Athena (AI, age/
 * role-aware, with a personal reason); otherwise Athena presents the deterministic
 * "saved" suggestions. Empty/failure states speak in Athena's encouraging voice and
 * never expose technical errors. Honors reduced-motion, and the request is cancelled
 * on unmount / when the selected member changes.
 */
export function GhostChoreEmptyStateSuggestions({
  assigneeId,
  assigneeName,
  viewerRole = "player",
  onAdded,
}: GhostChoreEmptyStateSuggestionsProps) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("thinking");
  const [pool, setPool] = useState<GhostSuggestion[]>([]);
  const [source, setSource] = useState<"athena" | "local">("local");
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  // Keep the latest reduced-motion value without re-running the fetch effect.
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const suggestions = pool.slice(0, MAX_EMPTY_STATE_SUGGESTIONS);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPhase("thinking");
    setError("");
    const startedAt = Date.now();

    void (async () => {
      let data: SuggestionsResponse | null = null;
      let failed = false;
      try {
        const query = assigneeId ? `?memberId=${encodeURIComponent(assigneeId)}` : "";
        const response = await fetch(`/api/chores/ghost-suggestions${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          failed = true;
        } else {
          data = (await response.json()) as SuggestionsResponse;
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        failed = true;
      }
      if (!active) {
        return;
      }

      // Always give Athena at least a brief thinking moment (skipped under reduced motion).
      const minThink = reducedMotionRef.current ? 0 : MIN_THINK_MS;
      const wait = Math.max(0, minThink - (Date.now() - startedAt));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (!active) {
        return;
      }

      if (failed || !data) {
        setPhase("failed");
        return;
      }
      const list = Array.isArray(data.suggestions) ? data.suggestions : [];
      setSource(data.source === "athena" ? "athena" : "local");
      setPool(list);
      if (list.length > 0) {
        setPhase("revealing");
      } else if (data.eligible === false) {
        // Player simply has chores to do — show nothing rather than an empty message.
        setPhase("hidden");
      } else {
        setPhase("empty");
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [assigneeId]);

  const handleAdd = useCallback(
    async (suggestion: GhostSuggestion) => {
      setPendingId(suggestion.id);
      setError("");
      try {
        const response = await fetch(
          `/api/chores/ghost-suggestions/${encodeURIComponent(suggestion.id)}/add`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assigneeId: assigneeId ?? "", assigneeName: assigneeName ?? "" }),
          },
        );
        if (!response.ok) {
          setError(t("ghost.addError"));
          return;
        }
        setPool((prev) => prev.filter((entry) => entry.id !== suggestion.id));
        await onAdded?.();
      } catch {
        setError(t("ghost.addError"));
      } finally {
        setPendingId("");
      }
    },
    [assigneeId, assigneeName, onAdded, t],
  );

  const handleDismiss = useCallback(async (suggestion: GhostSuggestion) => {
    setPendingId(suggestion.id);
    try {
      await fetch(`/api/chores/ghost-suggestions/${encodeURIComponent(suggestion.id)}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setPool((prev) => prev.filter((entry) => entry.id !== suggestion.id));
    } catch {
      // Leave the row in place on failure so the user can retry.
    } finally {
      setPendingId("");
    }
  }, []);

  if (phase === "hidden") {
    return null;
  }

  const isAthena = source === "athena";

  return (
    <div className={`ghost-suggestions-empty${isAthena ? " ghost-suggestions-athena" : ""}`}>
      {phase === "thinking" ? (
        <AthenaThinkingPanel role={viewerRole} subjectName={assigneeName} reducedMotion={reducedMotion} />
      ) : null}

      {phase === "empty" ? (
        <AthenaFallbackState message={t("ghost.thinking.empty")} reducedMotion={reducedMotion} />
      ) : null}

      {phase === "failed" ? (
        <AthenaFallbackState message={t("ghost.thinking.failure")} reducedMotion={reducedMotion} />
      ) : null}

      {phase === "revealing" && suggestions.length > 0 ? (
        <>
          {error ? <p className="ghost-suggestions-error small">{error}</p> : null}
          <AthenaSuggestionReveal
            reducedMotion={reducedMotion}
            headline={isAthena ? t("ghost.thinking.celebrationAthena") : t("ghost.thinking.celebrationSaved")}
          >
            {suggestions.map((suggestion) => {
              const isPending = pendingId === suggestion.id;
              const meta = suggestion.athena;
              const reason = meta?.reason || t(reasonKey(suggestion.source));
              return (
                <li
                  key={suggestion.id}
                  className={`today-chore-item ghost-chore-item${reducedMotion ? "" : " athena-reveal-animate"}`}
                  style={{ "--today-chore-rail-color": isAthena ? "#a78bfa" : "#c2ccdd" } as CSSProperties}
                >
                  <div className="flex min-w-0 flex-col gap-3 rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="ghost-chore-avatar" aria-hidden="true">
                          {isAthena ? "✨" : "\u{1F47B}"}
                        </span>
                        <div className="flex min-w-0 flex-col items-start gap-1">
                          <span className="today-chore-title-row flex flex-wrap items-center gap-x-2 gap-y-1">
                            <strong
                              className="break-words ghost-chore-name"
                              tabIndex={0}
                              title={reason}
                              aria-label={`${suggestion.suggestedTitle}. ${reason}`}
                            >
                              {suggestion.suggestedTitle}
                            </strong>
                            <span className={`ghost-chore-badge${isAthena ? " ghost-chore-badge-athena" : ""}`}>
                              {isAthena ? t("ghost.athenaBadge") : t("ghost.badge")}
                            </span>
                            {meta ? (
                              <span className="ghost-chore-type-chip">{t(suggestionTypeKey(meta.suggestionType))}</span>
                            ) : null}
                          </span>
                          {suggestion.suggestedDescription ? (
                            <span className="block break-words ghost-chore-subtle">
                              {suggestion.suggestedDescription}
                            </span>
                          ) : (
                            <span className="block break-words ghost-chore-subtle">{t("ghost.notAssigned")}</span>
                          )}
                        </div>
                      </div>
                      <div className="today-chore-meta-actions">
                        <span className="inline-flex items-center gap-1 text-lg font-bold leading-none text-amber-600">
                          <CoinIcon size={20} />
                          <span>{suggestion.suggestedCoinValue > 0 ? suggestion.suggestedCoinValue : "-"}</span>
                        </span>
                      </div>
                    </div>

                    {meta ? (
                      <div className="ghost-chore-meta-row flex flex-wrap items-center gap-2">
                        <span className={`ghost-chore-pill ghost-chore-pill-${meta.difficulty}`}>
                          {t(difficultyKey(meta.difficulty))}
                        </span>
                        {meta.estimatedMinutes ? (
                          <span className="ghost-chore-pill">
                            {t("ghost.minutes", { minutes: String(meta.estimatedMinutes) })}
                          </span>
                        ) : null}
                        {meta.categoryLabel ? <span className="ghost-chore-pill">{meta.categoryLabel}</span> : null}
                        {meta.requiresParentReview ? (
                          <span className="ghost-chore-pill ghost-chore-pill-review">{t("ghost.parentReview")}</span>
                        ) : null}
                      </div>
                    ) : null}

                    <p className="ghost-chore-reason small">
                      {isAthena ? <span aria-hidden="true">{"✨ "}</span> : null}
                      {reason}
                    </p>

                    {meta?.safetyNotes ? (
                      <p className="ghost-chore-safety small" role="note">
                        <strong>{t("ghost.safetyPrefix")} </strong>
                        {meta.safetyNotes}
                      </p>
                    ) : null}

                    <div className="today-chore-action-group flex items-stretch gap-2">
                      <Button
                        type="button"
                        className="btn btn-primary h-10 flex-1"
                        disabled={isPending}
                        onClick={() => handleAdd(suggestion)}
                      >
                        {isPending ? t("ghost.adding") : t("ghost.addChore")}
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary ghost-chore-dismiss h-10"
                        disabled={isPending}
                        onClick={() => handleDismiss(suggestion)}
                      >
                        {t("ghost.dismiss")}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </AthenaSuggestionReveal>
        </>
      ) : null}
    </div>
  );
}
