"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import { DEFAULT_CHORE_COIN_VALUE } from "@/lib/chores/recurrence";

// Shared editor for a routine's steps. Steps are real chores: either an
// existing family chore (picked from an autocomplete, carrying its coin value
// and approval setting) or a brand-new chore created by the routine. Used by
// both the Assign Routine dialog and the routine editor on /routines.

export type RoutineEditableStep = {
  id?: string;
  title: string;
  coinValue?: number;
  requireApproval?: boolean;
};

export type ChoreCatalogEntry = {
  title: string;
  coinValue: number;
  requireApproval: boolean;
};

type ChoreCatalogPayload = {
  chores?: Array<{
    title?: string;
    coinValue?: number;
    requireApproval?: boolean;
    createdAt?: string;
  }>;
  error?: string;
};

export function choreTitleKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Fetches the family's existing chores (deduped by title, newest wins) for
// the add-chore autocomplete. Best effort — without it, every step simply
// behaves like a new chore.
export function useChoreCatalog(active: boolean) {
  const [choreCatalog, setChoreCatalog] = useState<ChoreCatalogEntry[]>([]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/chores?page=1&limit=100&sortBy=title&sortDir=asc", {
          cache: "no-store",
        });
        const payload = (await response.json()) as ChoreCatalogPayload;
        if (!response.ok || cancelled) {
          return;
        }
        const byTitle = new Map<string, ChoreCatalogEntry & { createdAt: string }>();
        for (const chore of payload.chores ?? []) {
          const title = (chore.title ?? "").trim();
          const key = choreTitleKey(title);
          if (!key) {
            continue;
          }
          const createdAt = chore.createdAt ?? "";
          const existing = byTitle.get(key);
          if (!existing || createdAt > existing.createdAt) {
            byTitle.set(key, {
              title,
              coinValue: Math.max(0, Math.trunc(chore.coinValue ?? DEFAULT_CHORE_COIN_VALUE)),
              requireApproval: chore.requireApproval === true,
              createdAt,
            });
          }
        }
        setChoreCatalog(
          Array.from(byTitle.values()).sort((a, b) => a.title.localeCompare(b.title)),
        );
      } catch {
        // Autocomplete is an enhancement; typing a new chore always works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const choreCatalogByTitle = useMemo(() => {
    const map = new Map<string, ChoreCatalogEntry>();
    for (const entry of choreCatalog) {
      map.set(choreTitleKey(entry.title), entry);
    }
    return map;
  }, [choreCatalog]);

  return { choreCatalog, choreCatalogByTitle };
}

// Effective chore details for a step: explicit values (captured when the
// chore was picked from the catalog) win, then the catalog match by title,
// then new-chore defaults.
export function resolveStepChore(
  step: RoutineEditableStep,
  choreCatalogByTitle: Map<string, ChoreCatalogEntry>,
) {
  const matched = choreCatalogByTitle.get(choreTitleKey(step.title));
  return {
    coinValue: step.coinValue ?? matched?.coinValue ?? DEFAULT_CHORE_COIN_VALUE,
    requireApproval: step.requireApproval ?? matched?.requireApproval ?? false,
    isNewChore: !matched,
  };
}

type RoutineStepsEditorProps = {
  steps: RoutineEditableStep[];
  onChange: (steps: RoutineEditableStep[]) => void;
  choreCatalog: ChoreCatalogEntry[];
  choreCatalogByTitle: Map<string, ChoreCatalogEntry>;
  showNewChoreBadge?: boolean;
};

export function RoutineStepsEditor({
  steps,
  onChange,
  choreCatalog,
  choreCatalogByTitle,
  showNewChoreBadge = true,
}: RoutineStepsEditorProps) {
  const { t } = useLocale();
  const [newStepTitle, setNewStepTitle] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const suggestions = useMemo(() => {
    const query = newStepTitle.trim().toLowerCase();
    const usedTitles = new Set(steps.map((step) => choreTitleKey(step.title)));
    const candidates = choreCatalog.filter(
      (entry) => !usedTitles.has(choreTitleKey(entry.title)),
    );
    if (!query) {
      return candidates.slice(0, 6);
    }
    return candidates
      .filter((entry) => entry.title.toLowerCase().includes(query))
      .slice(0, 6);
  }, [choreCatalog, newStepTitle, steps]);

  const exactChoreMatch = choreCatalogByTitle.has(choreTitleKey(newStepTitle));

  function addExistingChore(entry: ChoreCatalogEntry) {
    onChange([
      ...steps,
      {
        title: entry.title,
        coinValue: entry.coinValue,
        requireApproval: entry.requireApproval,
      },
    ]);
    setNewStepTitle("");
    setSuggestionsOpen(false);
  }

  function addNewChore() {
    const title = newStepTitle.trim();
    if (!title) {
      return;
    }
    const matched = choreCatalogByTitle.get(choreTitleKey(title));
    if (matched) {
      addExistingChore(matched);
      return;
    }
    onChange([...steps, { title }]);
    setNewStepTitle("");
    setSuggestionsOpen(false);
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  // Inline edits pin explicit values onto the step, overriding whatever the
  // catalog match would supply.
  function updateStep(index: number, patch: Partial<RoutineEditableStep>) {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function moveStep(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= steps.length) {
      return;
    }
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.length === 0 ? (
        <p className="text-sm text-slate-500">{t("responsibility.assignDialog.noSteps")}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, index) => {
            const resolved = resolveStepChore(step, choreCatalogByTitle);
            return (
              <li key={`${step.id ?? "new"}_${index}`} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-500">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm text-slate-700">
                  {step.title}
                  {showNewChoreBadge && resolved.isNewChore ? (
                    <span className="ml-1.5 inline-flex rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                      {t("responsibility.assignDialog.newChoreBadge")}
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                    <CoinIcon size={13} />
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={1}
                      value={String(resolved.coinValue)}
                      aria-label={t("responsibility.assignDialog.coinsPerStepLabel")}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        updateStep(index, {
                          coinValue:
                            Number.isFinite(parsed) && parsed >= 0
                              ? Math.min(1000, Math.trunc(parsed))
                              : 0,
                        });
                      }}
                      onBlur={(event) => {
                        event.target.value = String(resolved.coinValue);
                      }}
                      className="h-7 w-14 rounded-md border border-slate-300 bg-white px-1.5 text-right text-xs font-semibold text-slate-800"
                    />
                  </span>
                  <button
                    type="button"
                    aria-pressed={resolved.requireApproval}
                    aria-label={t("responsibility.assignDialog.requiresApprovalBadge")}
                    title={t("responsibility.assignDialog.requiresApprovalBadge")}
                    onClick={() =>
                      updateStep(index, { requireApproval: !resolved.requireApproval })
                    }
                    className={`flex h-7 w-7 items-center justify-center rounded-md border text-sm ${
                      resolved.requireApproval
                        ? "border-sky-300 bg-sky-100"
                        : "border-slate-200 bg-white opacity-50 grayscale hover:opacity-80"
                    }`}>
                    <span aria-hidden="true">🔍</span>
                  </button>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    className="btn btn-secondary btn-sm px-2"
                    aria-label={t("responsibility.assignDialog.moveStepUp")}
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}>
                    ↑
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary btn-sm px-2"
                    aria-label={t("responsibility.assignDialog.moveStepDown")}
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}>
                    ↓
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary btn-sm px-2 text-red-600"
                    aria-label={t("responsibility.assignDialog.removeStep")}
                    onClick={() => removeStep(index)}>
                    ✕
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {/* Add a chore: autocomplete over the family's existing chores
          (inheriting their coins/approval) or create a new one. */}
      <div className="relative flex items-center gap-2">
        <input
          type="text"
          value={newStepTitle}
          maxLength={160}
          placeholder={t("responsibility.assignDialog.addStepPlaceholder")}
          onChange={(event) => {
            setNewStepTitle(event.target.value);
            setSuggestionsOpen(true);
          }}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => {
            // Delay so option mousedown can land first.
            window.setTimeout(() => setSuggestionsOpen(false), 150);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addNewChore();
            }
          }}
          className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800"
        />
        <Button
          type="button"
          className="btn btn-secondary h-9 shrink-0 px-3"
          onClick={addNewChore}>
          {t("common.actions.add")}
        </Button>
        {suggestionsOpen && (suggestions.length > 0 || newStepTitle.trim()) ? (
          <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            {suggestions.map((entry) => (
              <button
                key={entry.title}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  addExistingChore(entry);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {entry.title}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-600">
                  <CoinIcon size={12} />
                  {entry.coinValue}
                  {entry.requireApproval ? <span aria-hidden="true">🔍</span> : null}
                </span>
              </button>
            ))}
            {newStepTitle.trim() && !exactChoreMatch ? (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  addNewChore();
                }}
                className="w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-blue-600 hover:bg-slate-50">
                {t("responsibility.assignDialog.createNewChore", {
                  name: newStepTitle.trim(),
                })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
