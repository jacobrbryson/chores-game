"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";

type GhostSuggestion = {
  id: string;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCoinValue: number;
  source: string;
};

type SuggestionsResponse = {
  suggestions?: GhostSuggestion[];
  viewerRole?: "admin" | "player";
  eligible?: boolean;
};

const MAX_EMPTY_STATE_SUGGESTIONS = 3;

/** Explains WHY a suggestion is shown, derived from its deterministic source. */
function reasonKey(source: string) {
  if (source === "recent_chore") {
    return "ghost.reasonRecent" as const;
  }
  if (source === "family_history") {
    return "ghost.reasonHistory" as const;
  }
  return "ghost.reasonBuiltin" as const;
}

type GhostChoreEmptyStateSuggestionsProps = {
  /** Selected member to assign the chore to (admin flow); ignored for player see-and-do. */
  assigneeId?: string;
  assigneeName?: string;
  /** Called after a suggestion is added so the chore list can refresh. */
  onAdded?: () => Promise<void> | void;
};

/**
 * Smart Ghost Chores — shown inside the dashboard empty state (when the selected member
 * has no open chores), right under the "Add Chore" button. Renders up to three
 * deterministic, *safe* suggestions. These are NOT real chores: "Add Chore" creates one
 * (a normal chore for admins; a `see_and_do` chore for players) and upvotes the
 * suggestion on the backend; "Dismiss" hides it and downvotes it.
 */
export function GhostChoreEmptyStateSuggestions({
  assigneeId,
  assigneeName,
  onAdded,
}: GhostChoreEmptyStateSuggestionsProps) {
  const { t } = useLocale();
  // `pool` holds more suggestions than we display so dismissing/adding one can be
  // refilled from the next available idea; we only ever render the first three.
  const [pool, setPool] = useState<GhostSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const suggestions = pool.slice(0, MAX_EMPTY_STATE_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/chores/ghost-suggestions", { cache: "no-store" });
        if (!response.ok) {
          if (active) setPool([]);
          return;
        }
        const data = (await response.json()) as SuggestionsResponse;
        if (active) {
          setPool(Array.isArray(data.suggestions) ? data.suggestions : []);
        }
      } catch {
        if (active) setPool([]);
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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

  if (!loaded || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="ghost-suggestions-empty">
      <p className="ghost-suggestions-divider" role="separator">
        <span>{t("ghost.suggestedDivider")}</span>
      </p>
      {error ? <p className="ghost-suggestions-error small">{error}</p> : null}
      <ul className="family-list ghost-suggestions-empty-list">
        {suggestions.map((suggestion) => {
          const isPending = pendingId === suggestion.id;
          const reason = t(reasonKey(suggestion.source));
          return (
            <li
              key={suggestion.id}
              className="today-chore-item ghost-chore-item"
              style={{ "--today-chore-rail-color": "#c2ccdd" } as CSSProperties}>
              <div className="flex min-w-0 flex-col gap-3 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="ghost-chore-avatar" aria-hidden="true">
                      &#x1F47B;
                    </span>
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <span className="today-chore-title-row flex flex-wrap items-center gap-x-2 gap-y-1">
                        <strong
                          className="break-words ghost-chore-name"
                          tabIndex={0}
                          title={reason}
                          aria-label={`${suggestion.suggestedTitle}. ${reason}`}>
                          {suggestion.suggestedTitle}
                        </strong>
                        <span className="ghost-chore-badge">{t("ghost.badge")}</span>
                      </span>
                      <span className="block break-words ghost-chore-subtle">{t("ghost.notAssigned")}</span>
                    </div>
                  </div>
                  <div className="today-chore-meta-actions">
                    <span className="inline-flex items-center gap-1 text-lg font-bold leading-none text-amber-600">
                      <CoinIcon size={20} />
                      <span>{suggestion.suggestedCoinValue > 0 ? suggestion.suggestedCoinValue : "-"}</span>
                    </span>
                  </div>
                </div>
                <div className="today-chore-action-group flex items-stretch gap-2">
                  <Button
                    type="button"
                    className="btn btn-primary h-10 flex-1"
                    disabled={isPending}
                    onClick={() => handleAdd(suggestion)}>
                    {isPending ? t("ghost.adding") : t("ghost.addChore")}
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary ghost-chore-dismiss h-10"
                    disabled={isPending}
                    onClick={() => handleDismiss(suggestion)}>
                    {t("ghost.dismiss")}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
