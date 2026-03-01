"use client";

import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";

type Suggestion = {
  description: string;
  familyCount: number;
  globalCount: number;
};

type FamilyMemberOption = {
  id: string;
  uid?: string;
  name: string;
  role: "admin" | "player";
};

type EditableChore = {
  id: string;
  title: string;
  assigneeId?: string;
  dueDate?: string;
  details?: string;
};

type AddEditChoresDialogProps = {
  onSaved?: () => Promise<void> | void;
  triggerLabel?: string;
  triggerClassName?: string;
  chore?: EditableChore;
  renderTrigger?: (openDialog: () => void) => ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

const LAST_ASSIGNEE_STORAGE_KEY = "chores_last_assignee_id";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "request_failed";
}

function readLastAssigneeId() {
  try {
    return window.localStorage.getItem(LAST_ASSIGNEE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastAssigneeId(value: string) {
  try {
    if (!value) {
      window.localStorage.removeItem(LAST_ASSIGNEE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_ASSIGNEE_STORAGE_KEY, value);
  } catch {
    // Ignore storage errors.
  }
}

export function AddEditChoresDialog({
  onSaved,
  triggerLabel = "Let's add some!",
  triggerClassName = "btn btn-primary",
  chore,
  renderTrigger,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: AddEditChoresDialogProps) {
  const SUGGESTION_GAP_PX = 6;
  const SUGGESTION_VIEWPORT_MARGIN_PX = 8;
  const SUGGESTION_MIN_HEIGHT_PX = 120;
  const SUGGESTION_MAX_HEIGHT_PX = 224;

  const isEditMode = Boolean(chore);
  const editingChoreId = chore?.id ?? "";
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [details, setDetails] = useState("");
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestionMenu, setShowSuggestionMenu] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const descriptionFieldRef = useRef<HTMLDivElement | null>(null);
  const [suggestionMenuPosition, setSuggestionMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [members, setMembers] = useState<FamilyMemberOption[]>([]);
  const [assigneeHydrated, setAssigneeHydrated] = useState(false);
  const effectiveDueDate = showAdditionalOptions ? dueDate : todayIsoDate();

  function setDialogOpen(next: boolean) {
    if (controlledOpen === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  }

  const assigneeOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.id,
        label: `${member.name}${member.role === "admin" ? " (Parent)" : " (Child)"}`,
      })),
    [members],
  );
  const assigneeSelectOptions = useMemo<TailwindSelectOption[]>(
    () => [{ value: "", label: "Unassigned" }, ...assigneeOptions],
    [assigneeOptions],
  );

  const filteredSuggestions = useMemo(() => {
    const query = description.trim().toLowerCase();
    if (!query) {
      return suggestions;
    }
    return suggestions.filter((suggestion) =>
      suggestion.description.toLowerCase().includes(query),
    );
  }, [description, suggestions]);

  async function loadSuggestions(query = "") {
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    if (assigneeId) {
      params.set("assigneeId", assigneeId);
      params.set("dueDate", effectiveDueDate);
    }
    if (editingChoreId) {
      params.set("excludeChoreId", editingChoreId);
    }
    const qs = params.toString();
    const url = qs ? `/api/chores/suggestions?${qs}` : "/api/chores/suggestions";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? `SUGGESTIONS_HTTP_${response.status}`);
    }
    const payload = (await response.json()) as { suggestions?: Suggestion[] };
    setSuggestions(payload.suggestions ?? []);
  }

  async function loadMembers() {
    const response = await fetch("/api/family/summary", { cache: "no-store" });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? `FAMILY_HTTP_${response.status}`);
    }
    const payload = (await response.json()) as {
      members?: FamilyMemberOption[];
      viewerUid?: string;
    };
    const allMembers = payload.members ?? [];
    setMembers(allMembers);
    if (chore) {
      setAssigneeId(chore.assigneeId ?? "");
      setAssigneeHydrated(true);
      return;
    }
    const stickyAssigneeId = readLastAssigneeId();
    const stickyMember = allMembers.find((member) => member.id === stickyAssigneeId);
    const viewer = allMembers.find(
      (member) => member.id === payload.viewerUid || member.uid === payload.viewerUid,
    );
    setAssigneeId((current) => current || stickyMember?.id || viewer?.id || "");
    setAssigneeHydrated(true);
  }

  function hydrateFromChore() {
    setDescription(chore?.title ?? "");
    setAssigneeId(chore?.assigneeId ?? "");
    setDueDate(chore?.dueDate || todayIsoDate());
    setDetails(chore?.details ?? "");
    setShowAdditionalOptions(Boolean(chore?.dueDate || chore?.details));
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setAssigneeHydrated(false);
    hydrateFromChore();
    void Promise.all([loadSuggestions(), loadMembers()]).catch((loadError) => {
      setError(normalizeError(loadError));
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const query = description.trim();
    const timer = setTimeout(() => {
      void loadSuggestions(query.length >= 3 ? query : "").catch((loadError) => {
        setError(normalizeError(loadError));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [description, assigneeId, effectiveDueDate, open]);

  const updateSuggestionMenuPosition = useCallback(() => {
    if (!descriptionFieldRef.current || typeof window === "undefined") {
      return;
    }
    const rect = descriptionFieldRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom - SUGGESTION_VIEWPORT_MARGIN_PX;
    const spaceAbove = rect.top - SUGGESTION_VIEWPORT_MARGIN_PX;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(
      0,
      (openUpward ? spaceAbove : spaceBelow) - SUGGESTION_GAP_PX,
    );
    const maxHeight = Math.max(
      SUGGESTION_MIN_HEIGHT_PX,
      Math.min(SUGGESTION_MAX_HEIGHT_PX, availableHeight),
    );
    const width = Math.min(rect.width, viewportWidth - SUGGESTION_VIEWPORT_MARGIN_PX * 2);
    let left = rect.left;
    if (left + width > viewportWidth - SUGGESTION_VIEWPORT_MARGIN_PX) {
      left = viewportWidth - SUGGESTION_VIEWPORT_MARGIN_PX - width;
    }
    left = Math.max(SUGGESTION_VIEWPORT_MARGIN_PX, left);
    const top = openUpward
      ? Math.max(
          SUGGESTION_VIEWPORT_MARGIN_PX,
          rect.top - maxHeight - SUGGESTION_GAP_PX,
        )
      : Math.min(
          viewportHeight - SUGGESTION_VIEWPORT_MARGIN_PX,
          rect.bottom + SUGGESTION_GAP_PX,
        );

    setSuggestionMenuPosition({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    const shouldShow = open && showSuggestionMenu && filteredSuggestions.length > 0;
    if (!shouldShow) {
      return;
    }
    updateSuggestionMenuPosition();
    window.addEventListener("resize", updateSuggestionMenuPosition);
    window.addEventListener("scroll", updateSuggestionMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateSuggestionMenuPosition);
      window.removeEventListener("scroll", updateSuggestionMenuPosition, true);
    };
  }, [filteredSuggestions.length, open, showSuggestionMenu, updateSuggestionMenuPosition]);

  useEffect(() => {
    if (!open || !assigneeHydrated || !assigneeId || isEditMode) {
      return;
    }
    writeLastAssigneeId(assigneeId);
  }, [assigneeId, assigneeHydrated, isEditMode, open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    const normalizedDescription = description.trim();
    if (!normalizedDescription) {
      setError("description_required");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        isEditMode ? `/api/chores/${editingChoreId}` : "/api/chores",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEditMode
              ? {
                  action: "edit",
                  description: normalizedDescription,
                  assigneeId,
                  dueDate: showAdditionalOptions ? dueDate : todayIsoDate(),
                  details: showAdditionalOptions ? details : "",
                }
              : {
                  description: normalizedDescription,
                  assigneeId,
                  dueDate: showAdditionalOptions ? dueDate : undefined,
                  details: showAdditionalOptions ? details : "",
                },
          ),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(
          body.error ??
            (isEditMode
              ? `UPDATE_CHORE_HTTP_${response.status}`
              : `CREATE_CHORES_HTTP_${response.status}`),
        );
      }

      setDialogOpen(false);
      setDescription("");
      setShowSuggestionMenu(false);
      setActiveSuggestionIndex(-1);
      setAssigneeId("");
      setDueDate(todayIsoDate());
      setDetails("");
      setShowAdditionalOptions(false);
      if (onSaved) {
        await onSaved();
      }
    } catch (submitError) {
      setError(normalizeError(submitError));
    } finally {
      setSaving(false);
    }
  }

  function applySuggestion(value: string) {
    setDescription(value);
    setShowSuggestionMenu(false);
    setActiveSuggestionIndex(-1);
  }

  function onDescriptionKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (filteredSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setShowSuggestionMenu(true);
      setActiveSuggestionIndex((index) =>
        index < filteredSuggestions.length - 1 ? index + 1 : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setShowSuggestionMenu(true);
      setActiveSuggestionIndex((index) =>
        index > 0 ? index - 1 : filteredSuggestions.length - 1,
      );
      return;
    }

    if (event.key === "Enter" && showSuggestionMenu) {
      const selected = filteredSuggestions[Math.max(activeSuggestionIndex, 0)];
      if (selected) {
        event.preventDefault();
        applySuggestion(selected.description);
      }
    }
  }

  const descriptionSuggestionMenuNode =
    open &&
    showSuggestionMenu &&
    filteredSuggestions.length > 0 &&
    suggestionMenuPosition &&
    typeof document !== "undefined"
      ? createPortal(
          <ul
            className="z-[70] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{
              position: "fixed",
              top: suggestionMenuPosition.top,
              left: suggestionMenuPosition.left,
              width: suggestionMenuPosition.width,
              maxHeight: suggestionMenuPosition.maxHeight,
            }}>
            {filteredSuggestions.map((suggestion, index) => (
              <li key={suggestion.description}>
                <Button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm ${
                    index === activeSuggestionIndex
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestion(suggestion.description);
                  }}>
                  {suggestion.description}
                </Button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setDialogOpen(true))
      ) : hideTrigger ? null : (
        <Button
          type="button"
          className={triggerClassName}
          onClick={() => setDialogOpen(true)}>
          {triggerLabel}
        </Button>
      )}
      <ModalShell open={open} onRequestClose={() => setDialogOpen(false)}>
        <div className="add-chores-modal-card w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold text-slate-800">
              {isEditMode ? "Edit Chore" : "Add Chores"}
            </h3>
            <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Description</span>
                <div ref={descriptionFieldRef} className="relative">
                  <input
                    required
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setActiveSuggestionIndex(-1);
                    }}
                    onFocus={() => setShowSuggestionMenu(true)}
                    onBlur={() => setTimeout(() => setShowSuggestionMenu(false), 100)}
                    onKeyDown={onDescriptionKeyDown}
                    placeholder="Take out trash"
                    className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                  />
                </div>
              </label>

              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Assignee</span>
                <TailwindSelect
                  ariaLabel="Assignee"
                  value={assigneeId}
                  onChange={setAssigneeId}
                  options={assigneeSelectOptions}
                  className="w-full"
                  buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  menuClassName="border-slate-300"
                />
              </label>

              <Button
                type="button"
                className="group inline-flex cursor-pointer items-center gap-2 self-start text-sm font-semibold text-[#1f69b7]"
                onClick={() => setShowAdditionalOptions((openState) => !openState)}>
                <span aria-hidden="true" className="text-base leading-none font-bold">
                  {showAdditionalOptions ? "-" : "+"}
                </span>
                <span className="group-hover:underline group-focus-visible:underline">
                  Additional Options
                </span>
              </Button>

              <div
                className={`add-chores-advanced${showAdditionalOptions ? " is-open" : ""}`}
                aria-hidden={!showAdditionalOptions}>
                <div className="add-chores-advanced-inner">
                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">Due Date</span>
                    <input
                      type="date"
                      value={dueDate}
                      disabled={!showAdditionalOptions}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
                    />
                  </label>

                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">Additional Details</span>
                    <textarea
                      rows={4}
                      value={details}
                      disabled={!showAdditionalOptions}
                      onChange={(event) => setDetails(event.target.value)}
                      placeholder="Any notes for this chore..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                    />
                  </label>
                </div>
              </div>

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              <div className="mt-1 flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}>
                  {saving
                    ? "Saving..."
                    : isEditMode
                      ? "Save Changes"
                      : "Add Chore"}
                </Button>
              </div>
            </form>
        </div>
      </ModalShell>
      {descriptionSuggestionMenuNode}
    </>
  );
}
