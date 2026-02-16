"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

type AddChoresDialogProps = {
  onCreated?: () => Promise<void> | void;
  triggerLabel?: string;
};

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

export function AddChoresDialog({
  onCreated,
  triggerLabel = "Let's add some!",
}: AddChoresDialogProps) {
  const [open, setOpen] = useState(false);
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
  const [members, setMembers] = useState<FamilyMemberOption[]>([]);
  const [assigneeHydrated, setAssigneeHydrated] = useState(false);

  const assigneeOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.id,
        label: `${member.name}${member.role === "admin" ? " (Parent)" : " (Child)"}`,
      })),
    [members],
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
    const url = query
      ? `/api/chores/suggestions?q=${encodeURIComponent(query)}`
      : "/api/chores/suggestions";
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
    const stickyAssigneeId = readLastAssigneeId();
    const stickyMember = allMembers.find((member) => member.id === stickyAssigneeId);
    const viewer = allMembers.find(
      (member) => member.id === payload.viewerUid || member.uid === payload.viewerUid,
    );
    setAssigneeId((current) => current || stickyMember?.id || viewer?.id || "");
    setAssigneeHydrated(true);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setAssigneeHydrated(false);
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
  }, [description, open]);

  useEffect(() => {
    if (!open || !assigneeHydrated || !assigneeId) {
      return;
    }
    writeLastAssigneeId(assigneeId);
  }, [assigneeId, assigneeHydrated, open]);

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
      const response = await fetch("/api/chores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: normalizedDescription,
          assigneeId,
          dueDate: showAdditionalOptions ? dueDate : undefined,
          details: showAdditionalOptions ? details : "",
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CREATE_CHORES_HTTP_${response.status}`);
      }

      setOpen(false);
      setDescription("");
      setShowSuggestionMenu(false);
      setActiveSuggestionIndex(-1);
      setAssigneeId("");
      setDueDate(todayIsoDate());
      setDetails("");
      setShowAdditionalOptions(false);
      if (onCreated) {
        await onCreated();
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

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold text-slate-800">Add Chores</h3>
            <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Description</span>
                <div className="relative">
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
                  {showSuggestionMenu && filteredSuggestions.length > 0 ? (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                      {filteredSuggestions.map((suggestion, index) => (
                        <li key={suggestion.description}>
                          <button
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
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </label>

              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Assignee</span>
                <select
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800">
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((member) => (
                    <option key={member.value} value={member.value}>
                      {member.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="self-start text-sm font-semibold text-[#1f69b7] hover:underline"
                onClick={() => setShowAdditionalOptions((openState) => !openState)}>
                Additional Options
              </button>

              {showAdditionalOptions ? (
                <>
                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">Due Date</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
                    />
                  </label>

                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">Additional Details</span>
                    <textarea
                      rows={4}
                      value={details}
                      onChange={(event) => setDetails(event.target.value)}
                      placeholder="Any notes for this chore..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                    />
                  </label>
                </>
              ) : null}

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                  disabled={saving}
                  onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-md border border-blue-300 bg-blue-50 px-3 text-sm font-semibold text-blue-700"
                  disabled={saving}>
                  {saving ? "Saving..." : "Add Chore"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
