"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  assigneeId?: string;
  assigneeName: string;
  details?: string;
  dueDate: string;
  completedAt?: string;
  coinValue: number;
  createdAt?: string;
};

type ChoresResponse = {
  chores: ChoreRow[];
  viewerRole?: "admin" | "player";
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ChoreResponse = {
  chore?: ChoreRow;
  viewerRole?: "admin" | "player";
};
type ChoreSortBy =
  | "title"
  | "status"
  | "assigneeName"
  | "dueDate"
  | "completedAt"
  | "coinValue";

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function choreCompletedAt(chore: ChoreRow) {
  if (chore.status === "Submitted" || chore.status === "Approved") {
    return chore.completedAt || "";
  }
  return "";
}

function sortChoreRows(rows: ChoreRow[], sortBy: ChoreSortBy, sortDir: "asc" | "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA =
      sortBy === "title"
        ? a.title
        : sortBy === "status"
          ? a.status
          : sortBy === "assigneeName"
            ? a.assigneeName
            : sortBy === "dueDate"
              ? a.dueDate
              : sortBy === "completedAt"
                ? choreCompletedAt(a)
                : a.coinValue;
    const valueB =
      sortBy === "title"
        ? b.title
        : sortBy === "status"
          ? b.status
          : sortBy === "assigneeName"
            ? b.assigneeName
            : sortBy === "dueDate"
              ? b.dueDate
              : sortBy === "completedAt"
                ? choreCompletedAt(b)
                : b.coinValue;
    const compared = compareValues(valueA, valueB);
    if (compared !== 0) {
      return compared * direction;
    }
    return (toUnixMillis(b.createdAt) - toUnixMillis(a.createdAt)) * direction;
  });
}

function getStatusLabel(status: string) {
  if (status === "Submitted") {
    return "Completed";
  }
  return status;
}

function statusTone(status: string) {
  if (status === "Open") {
    return "blue";
  }
  if (status === "Submitted" || status === "Approved") {
    return "green";
  }
  if (status === "Rejected") {
    return "rose";
  }
  return "slate";
}

function formatCompletedDate(value?: string) {
  if (!value) {
    return "-";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleDateString();
}

type RowActionState = {
  choreId: string;
  action: "delete" | "undo_complete";
};

type ChoreActionsMenuProps = {
  chore: ChoreRow;
  canManageActions: boolean;
  busyAction: "" | "delete" | "undo_complete";
  disabled: boolean;
  onEdit: (chore: ChoreRow) => void;
  onDeleteRequested: (chore: ChoreRow) => void;
  onUndoCompletion: (choreId: string) => Promise<void> | void;
};

function ChoreActionsMenu({
  chore,
  canManageActions,
  busyAction,
  disabled,
  onEdit,
  onDeleteRequested,
  onUndoCompletion,
}: ChoreActionsMenuProps) {
  if (!canManageActions) {
    return null;
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canUndoCompletion = chore.status === "Submitted" || chore.status === "Approved";

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <Button
        type="button"
        aria-label="Chore options"
        aria-expanded={menuOpen}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => setMenuOpen((current) => !current)}>
        <span className="text-lg leading-none">...</span>
      </Button>
      {menuOpen ? (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <Button
            type="button"
            className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setMenuOpen(false);
              onEdit(chore);
            }}>
            Edit
          </Button>
          <Button
            type="button"
            className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUndoCompletion || disabled}
            onClick={() => {
              setMenuOpen(false);
              void onUndoCompletion(chore.id);
            }}>
            {busyAction === "undo_complete" ? "Undoing..." : "Undo completion"}
          </Button>
          <Button
            type="button"
            className="block w-full rounded px-2 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              setMenuOpen(false);
              onDeleteRequested(chore);
            }}>
            {busyAction === "delete" ? "Deleting..." : "Delete"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function ChoresPage() {
  const [chores, setChores] = useState<ChoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [rowActionState, setRowActionState] = useState<RowActionState | null>(null);
  const [editingChore, setEditingChore] = useState<ChoreRow | null>(null);
  const [pendingDeleteChore, setPendingDeleteChore] = useState<ChoreRow | null>(null);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<ChoreSortBy>("dueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [realtimeContext, setRealtimeContext] = useState<{ uid: string; familyId: string } | null>(null);
  const canCreateChores = viewerRole === "admin";
  const requestSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const shouldApplySearch = query.trim().length >= 3;
  const hasShortSearch = searchInput.trim().length > 0 && searchInput.trim().length < 3;

  const loadChores = useCallback(async (options?: { silent?: boolean; pageOverride?: number }) => {
    const silent = options?.silent ?? false;
    const targetPage = options?.pageOverride ?? page;
    if (!silent) {
      setIsLoading(true);
    }
    setLoadError("");
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const params = new URLSearchParams();
      params.set("page", String(targetPage));
      params.set("limit", String(pageSize));
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      if (shouldApplySearch) {
        params.set("q", query.trim());
      }
      const response = await fetch(`/api/chores?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CHORES_HTTP_${response.status}`);
      }
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      const payload = (await response.json()) as ChoresResponse;
      setChores(sortChoreRows(payload.chores ?? [], sortBy, sortDir));
      setViewerRole(payload.viewerRole === "admin" ? "admin" : "player");
      setPage(payload.pagination?.page ?? targetPage);
      setTotal(payload.pagination?.total ?? payload.chores.length ?? 0);
      setTotalPages(payload.pagination?.totalPages ?? 1);
    } catch (loadErrorValue) {
      if (controller.signal.aborted) {
        return;
      }
      const message =
        loadErrorValue instanceof Error ? loadErrorValue.message : "chores_unavailable";
      setLoadError(message);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [page, pageSize, query, shouldApplySearch, sortBy, sortDir]);

  const applyChoreRow = useCallback((row: ChoreRow | null, choreId: string) => {
    setChores((current) => {
      const next = current.filter((entry) => entry.id !== choreId);
      if (!row) {
        return next;
      }
      return sortChoreRows([...next, row], sortBy, sortDir);
    });
  }, [sortBy, sortDir]);

  const refreshChoreRowFromApi = useCallback(async (choreId: string) => {
    try {
      const response = await fetch(`/api/chores/${choreId}`, { cache: "no-store" });
      if (!response.ok) {
        applyChoreRow(null, choreId);
        return;
      }
      const payload = (await response.json()) as ChoreResponse;
      if (!payload.chore) {
        applyChoreRow(null, choreId);
        return;
      }
      applyChoreRow(payload.chore, choreId);
    } catch {
      // Keep current row state on transient realtime sync failure.
    }
  }, [applyChoreRow]);

  const loadRealtimeContext = useCallback(async () => {
    try {
      const response = await fetch("/api/family/summary", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        viewerUid?: string;
        family?: { id?: string } | null;
      };
      const viewerUid = payload.viewerUid ?? "";
      const familyId = payload.family?.id ?? "";
      if (!viewerUid || !familyId) {
        return;
      }
      setRealtimeContext({ uid: viewerUid, familyId });
    } catch {
      // Realtime enhancements are best-effort.
    }
  }, []);

  useEffect(() => {
    void loadRealtimeContext();
  }, [loadRealtimeContext]);

  useEffect(() => {
    void loadChores({ pageOverride: page });
  }, [loadChores, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(searchInput.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!realtimeContext) {
      return;
    }
    const socket = connectFamilySocket({
      uid: realtimeContext.uid,
      familyIds: [realtimeContext.familyId],
    });
    if (!socket) {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onFamilyActivity = (event: FamilyActivityEvent) => {
      if (event.familyId !== realtimeContext.familyId) {
        return;
      }
      if (event.type === "chore_deleted") {
        if (event.choreId) {
          applyChoreRow(null, event.choreId);
        }
      } else if (event.choreId) {
        if (shouldApplySearch) {
          void loadChores({ silent: true });
        } else {
          void refreshChoreRowFromApi(event.choreId);
        }
      }
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("notifications:refresh"));
          window.dispatchEvent(new Event("wallet:refresh"));
        }
      }, 80);
    };

    socket.on("family:activity", onFamilyActivity);
    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      socket.off("family:activity", onFamilyActivity);
    };
  }, [applyChoreRow, loadChores, realtimeContext, refreshChoreRowFromApi, shouldApplySearch]);

  const sortLabel = useMemo(
    () => (column: ChoreSortBy, label: string) =>
      sortBy === column ? `${label} ${sortDir === "asc" ? "↑" : "↓"}` : label,
    [sortBy, sortDir],
  );

  function onSort(column: ChoreSortBy) {
    setPage(1);
    setSortDir((currentDir) =>
      sortBy === column ? (currentDir === "asc" ? "desc" : "asc") : "asc",
    );
    setSortBy(column);
  }

  async function onRemoveChore(choreId: string) {
    if (rowActionState) {
      return false;
    }
    setRowActionState({ choreId, action: "delete" });
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      await loadChores({ silent: true });
      return true;
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : "remove_chore_failed";
      setActionError(message);
      return false;
    } finally {
      setRowActionState(null);
    }
  }

  async function onUndoCompletion(choreId: string) {
    if (rowActionState) {
      return;
    }
    setRowActionState({ choreId, action: "undo_complete" });
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo_complete" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `UNDO_COMPLETE_HTTP_${response.status}`);
      }
      await loadChores({ silent: true });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    } catch (undoError) {
      const message =
        undoError instanceof Error ? undoError.message : "undo_complete_failed";
      setActionError(message);
    } finally {
      setRowActionState(null);
    }
  }

  return (
    <>
      <main className="panel family-page">
          <AddEditChoresDialog
            chore={
              editingChore
                ? {
                    id: editingChore.id,
                    title: editingChore.title,
                    assigneeId: editingChore.assigneeId,
                    dueDate: editingChore.dueDate,
                    details: editingChore.details,
                  }
                : undefined
            }
            onSaved={() => loadChores({ silent: true })}
            open={Boolean(editingChore)}
            onOpenChange={(open) => {
              if (!open) {
                setEditingChore(null);
              }
            }}
            hideTrigger
          />
          <BackLink />
          <h1>All Chores</h1>
          <div className="table-controls">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search chores (3+ chars)"
              className="table-search-input"
            />
            {hasShortSearch ? <p className="small">Type at least 3 characters to filter.</p> : null}
          </div>
          {isLoading ? <p className="small">Loading chores...</p> : null}
          {!isLoading && loadError ? (
            <p className="small family-error">Could not load chores: {loadError}</p>
          ) : null}
          {!isLoading && !loadError ? (
            <>
              {actionError ? (
                <p className="small family-error mb-3">Chore update failed: {actionError}</p>
              ) : null}
              {chores.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="small">No chores found.</p>
                  {canCreateChores ? (
                    <div className="chores-empty-cta">
                      <AddEditChoresDialog onSaved={() => loadChores({ silent: true })} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="small family-page-subhead">
                    {total} chore{total === 1 ? "" : "s"}
                  </p>
                  <div className="family-table-wrap">
                    <table className="family-table">
                      <thead>
                        <tr>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("title")}>
                              {sortLabel("title", "Title")}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("status")}>
                              {sortLabel("status", "Status")}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("assigneeName")}>
                              {sortLabel("assigneeName", "Assignee")}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("dueDate")}>
                              {sortLabel("dueDate", "Due Date")}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("completedAt")}>
                              {sortLabel("completedAt", "Completed Date")}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("coinValue")}>
                              {sortLabel("coinValue", "Coins")}
                            </button>
                          </th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {chores.map((chore) => (
                          <tr key={chore.id}>
                            <td>{chore.title}</td>
                            <td>
                              <EnumChip
                                label={getStatusLabel(chore.status)}
                                tone={statusTone(chore.status)}
                              />
                            </td>
                            <td>{chore.assigneeName || "-"}</td>
                            <td>{chore.dueDate || "-"}</td>
                            <td>{formatCompletedDate(chore.completedAt)}</td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                                <span aria-hidden="true">&#x1FA99;</span>
                                {chore.coinValue}
                              </span>
                            </td>
                            <td>
                              <ChoreActionsMenu
                                chore={chore}
                                canManageActions={viewerRole === "admin"}
                                busyAction={
                                  rowActionState?.choreId === chore.id ? rowActionState.action : ""
                                }
                                disabled={Boolean(rowActionState)}
                                onEdit={(selectedChore) => setEditingChore(selectedChore)}
                                onDeleteRequested={(selectedChore) => setPendingDeleteChore(selectedChore)}
                                onUndoCompletion={onUndoCompletion}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {canCreateChores ? (
                    <div className="chores-empty-cta chores-add-more-cta">
                      <AddEditChoresDialog
                        triggerLabel="Add more chores"
                        onSaved={() => loadChores({ silent: true })}
                      />
                    </div>
                  ) : null}
                  <div className="table-pager">
                    <Button
                      type="button"
                      className="btn btn-secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      Previous
                    </Button>
                    <span className="small">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      type="button"
                      className="btn btn-secondary"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                      Next
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : null}
      </main>
      <ModalShell
        open={Boolean(pendingDeleteChore)}
        onRequestClose={() => setPendingDeleteChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingDeleteChore ? (
            <>
              <h3 className="mb-2 text-lg font-bold text-slate-800">Delete Chore</h3>
              <p className="mb-4 text-sm text-slate-600">
                Delete <strong>{pendingDeleteChore.title}</strong>?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  disabled={Boolean(rowActionState)}
                  onClick={() => setPendingDeleteChore(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  disabled={Boolean(rowActionState)}
                  onClick={async () => {
                    const removed = await onRemoveChore(pendingDeleteChore.id);
                    if (removed) {
                      setPendingDeleteChore(null);
                    }
                  }}>
                  {rowActionState?.choreId === pendingDeleteChore.id &&
                  rowActionState.action === "delete"
                    ? "Deleting..."
                    : "Delete"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </>
  );
}
