"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { EnumChip } from "@/components/enum-chip";
import { GoogleTaskSyncIndicator } from "@/components/google-task-sync-indicator";
import { ModalShell } from "@/components/modal-shell";
import { parseCompletionWindow } from "@/lib/preferences/completion-window";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";

type ChoreCategory = {
  id: string;
  name: string;
  color: string;
};

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  source?: "manual" | "google_tasks";
  assigneeId?: string;
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  details?: string;
  dueDate: string;
  categoryIds?: string[];
  categories?: ChoreCategory[];
  completedAt?: string;
  coinValue: number;
  createdAt?: string;
};

type ChoresResponse = {
  chores: ChoreRow[];
  viewerRole?: "admin" | "player";
  viewerUid?: string;
  viewerAssigneeAliases?: string[];
  viewerGoogleTasksLinked?: boolean;
  familyId?: string;
  wsAuthToken?: string;
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

function parseTimezoneOffsetMinutes(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.trunc(parsed);
  if (Math.abs(rounded) > 14 * 60) {
    return null;
  }
  return rounded;
}

type RouteFilterState = {
  assigneeId: string;
  status: "" | "completed";
  completedWindow: ReturnType<typeof parseCompletionWindow>;
  tzOffsetMinutes: number | null;
};

function parseRouteFilters(search: string): RouteFilterState {
  const params = new URLSearchParams(search);
  return {
    assigneeId: (params.get("assigneeId") ?? "").trim(),
    status: params.get("status") === "completed" ? "completed" : "",
    completedWindow: parseCompletionWindow(params.get("completedWindow")),
    tzOffsetMinutes: parseTimezoneOffsetMinutes(params.get("tzOffsetMinutes")),
  };
}

type RowActionState = {
  choreId: string;
  action: "delete" | "undo_complete";
};
type BulkActionState = {
  action: "delete" | "undo_complete";
  total: number;
  completed: number;
};

type SelectedChoreState = {
  canUndoCompletion: boolean;
};

function normalizeAssigneeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function canUndoCompletion(status: string) {
  return status === "Submitted" || status === "Approved";
}

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
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const canUndoCompletion = chore.status === "Submitted" || chore.status === "Approved";

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current || typeof window === "undefined") {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const menuWidth = 160;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(rect.right - menuWidth, viewportWidth - menuWidth - margin),
    );
    setMenuPosition({
      top: rect.bottom + 6,
      left,
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    updateMenuPosition();

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }
    function onWindowChange() {
      updateMenuPosition();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [menuOpen, updateMenuPosition]);

  return (
    <div className="relative" ref={triggerRef}>
      <Button
        type="button"
        aria-label="Chore options"
        aria-expanded={menuOpen}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => setMenuOpen((current) => !current)}>
        <span className="text-lg leading-none">...</span>
      </Button>
      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[90] mt-1 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: menuPosition.top, left: menuPosition.left }}>
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}


type BulkActionsMenuProps = {
  disabled: boolean;
  selectedUndoCount: number;
  busyAction: "" | "delete" | "undo_complete";
  onDeleteRequested: () => void;
  onUndoCompletion: () => void;
};

function BulkActionsMenu({
  disabled,
  selectedUndoCount,
  busyAction,
  onDeleteRequested,
  onUndoCompletion,
}: BulkActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current || typeof window === "undefined") {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const menuWidth = 180;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(rect.right - menuWidth, viewportWidth - menuWidth - margin),
    );
    setMenuPosition({
      top: rect.bottom + 6,
      left,
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    updateMenuPosition();

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }
    function onWindowChange() {
      updateMenuPosition();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [menuOpen, updateMenuPosition]);

  return (
    <div className="relative" ref={triggerRef}>
      <Button
        type="button"
        aria-label="Bulk actions"
        aria-expanded={menuOpen}
        className="btn btn-secondary h-9 px-3 py-2 text-sm"
        disabled={disabled}
        onClick={() => setMenuOpen((current) => !current)}>
        Bulk Actions
      </Button>
      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[90] mt-1 w-44 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: menuPosition.top, left: menuPosition.left }}>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteRequested();
                }}>
                {busyAction === "delete" ? "Deleting..." : "Delete"}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || selectedUndoCount <= 0}
                onClick={() => {
                  setMenuOpen(false);
                  onUndoCompletion();
                }}>
                {busyAction === "undo_complete" ? "Undoing..." : "Undo completion"}
              </Button>
            </div>,
            document.body,
          )
        : null}
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
  const [pendingBulkDeleteOpen, setPendingBulkDeleteOpen] = useState(false);
  const [viewerUid, setViewerUid] = useState("");
  const [viewerAssigneeAliases, setViewerAssigneeAliases] = useState<string[]>([]);
  const [viewerGoogleTasksLinked, setViewerGoogleTasksLinked] = useState(false);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [selectedChoreStateById, setSelectedChoreStateById] = useState<Record<string, SelectedChoreState>>({});
  const [bulkActionState, setBulkActionState] = useState<BulkActionState | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<ChoreSortBy>("completedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [realtimeContext, setRealtimeContext] = useState<{ familyId: string; authToken: string } | null>(null);
  const canCreateChores = viewerRole === "admin";
  const requestSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const shouldApplySearch = query.trim().length >= 3;
  const hasShortSearch = searchInput.trim().length > 0 && searchInput.trim().length < 3;
  const [routeFilters, setRouteFilters] = useState<RouteFilterState>(() => {
    if (typeof window === "undefined") {
      return {
        assigneeId: "",
        status: "",
        completedWindow: null,
        tzOffsetMinutes: null,
      };
    }
    return parseRouteFilters(window.location.search);
  });
  const assigneeIdFilter = routeFilters.assigneeId;
  const statusFilter = routeFilters.status;
  const completedWindowFilter = routeFilters.completedWindow;
  const completionFilterTimezoneOffset =
    routeFilters.tzOffsetMinutes ??
    new Date().getTimezoneOffset();

  const viewerAssigneeAliasSet = useMemo(() => {
    const aliases = new Set<string>();
    if (viewerUid) {
      aliases.add(normalizeAssigneeAlias(viewerUid));
    }
    for (const alias of viewerAssigneeAliases) {
      const normalizedAlias = normalizeAssigneeAlias(alias);
      if (normalizedAlias) {
        aliases.add(normalizedAlias);
      }
    }
    return aliases;
  }, [viewerAssigneeAliases, viewerUid]);
  const hasBusyAction = Boolean(rowActionState) || Boolean(bulkActionState);
  const selectedChoreIds = useMemo(() => Object.keys(selectedChoreStateById), [selectedChoreStateById]);
  const selectedCount = selectedChoreIds.length;
  const selectedUndoCount = useMemo(
    () => Object.values(selectedChoreStateById).filter((entry) => entry.canUndoCompletion).length,
    [selectedChoreStateById],
  );
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const canManageBulkActionsForChore = useCallback((chore: ChoreRow) => {
    if (viewerRole === "admin") {
      return true;
    }
    const assigneeAlias = normalizeAssigneeAlias(chore.assigneeId);
    if (!assigneeAlias) {
      return false;
    }
    return viewerAssigneeAliasSet.has(assigneeAlias);
  }, [viewerAssigneeAliasSet, viewerRole]);

  const selectableChoreIdsOnPage = useMemo(
    () => chores.filter((chore) => canManageBulkActionsForChore(chore)).map((chore) => chore.id),
    [canManageBulkActionsForChore, chores],
  );
  const selectedOnPageCount = useMemo(
    () => selectableChoreIdsOnPage.filter((choreId) => Boolean(selectedChoreStateById[choreId])).length,
    [selectableChoreIdsOnPage, selectedChoreStateById],
  );
  const allSelectableOnPageSelected =
    selectableChoreIdsOnPage.length > 0 && selectedOnPageCount === selectableChoreIdsOnPage.length;
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncRouteFilters = () => {
      setRouteFilters(parseRouteFilters(window.location.search));
    };
    syncRouteFilters();
    window.addEventListener("popstate", syncRouteFilters);
    return () => {
      window.removeEventListener("popstate", syncRouteFilters);
    };
  }, []);

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
      if (assigneeIdFilter) {
        params.set("assigneeId", assigneeIdFilter);
      }
      if (statusFilter === "completed") {
        params.set("status", "completed");
      }
      params.set("tzOffsetMinutes", String(completionFilterTimezoneOffset));
      if (completedWindowFilter) {
        params.set("completedWindow", completedWindowFilter);
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
      setViewerUid(payload.viewerUid ?? "");
      setViewerGoogleTasksLinked(Boolean(payload.viewerGoogleTasksLinked));
      setViewerAssigneeAliases(payload.viewerAssigneeAliases ?? []);
      setPage(payload.pagination?.page ?? targetPage);
      setTotal(payload.pagination?.total ?? payload.chores.length ?? 0);
      setTotalPages(payload.pagination?.totalPages ?? 1);
      const familyId = payload.familyId?.trim() ?? "";
      const authToken = payload.wsAuthToken?.trim() ?? "";
      if (familyId && authToken) {
        setRealtimeContext({ familyId, authToken });
      } else {
        setRealtimeContext(null);
      }
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
  }, [
    assigneeIdFilter,
    completedWindowFilter,
    completionFilterTimezoneOffset,
    page,
    pageSize,
    query,
    shouldApplySearch,
    sortBy,
    sortDir,
    statusFilter,
  ]);

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
      authToken: realtimeContext.authToken,
    });
    if (!socket) {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onFamilyActivity = (event: FamilyActivityEvent) => {
      if (event.familyId !== realtimeContext.familyId) {
        return;
      }
      if (event.type === "theme_changed" || event.type === "avatar_changed") {
        void loadChores({ silent: true });
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

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedOnPageCount > 0 && selectedOnPageCount < selectableChoreIdsOnPage.length;
    }
  }, [selectedOnPageCount, selectableChoreIdsOnPage.length]);

  useEffect(() => {
    setSelectedChoreStateById((current) => {
      let changed = false;
      const next: Record<string, SelectedChoreState> = { ...current };
      for (const chore of chores) {
        if (!next[chore.id]) {
          continue;
        }
        if (!canManageBulkActionsForChore(chore)) {
          delete next[chore.id];
          changed = true;
          continue;
        }
        const nextCanUndo = canUndoCompletion(chore.status);
        if (next[chore.id].canUndoCompletion !== nextCanUndo) {
          next[chore.id] = { canUndoCompletion: nextCanUndo };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [canManageBulkActionsForChore, chores]);

  const sortLabel = useMemo(
    () => (column: ChoreSortBy, label: string) =>
      sortBy === column ? `${label} ${sortDir === "asc" ? "^" : "v"}` : label,
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
    if (hasBusyAction) {
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
      setSelectedChoreStateById((current) => {
        if (!current[choreId]) {
          return current;
        }
        const next = { ...current };
        delete next[choreId];
        return next;
      });
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
    if (hasBusyAction) {
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
      setSelectedChoreStateById((current) => {
        if (!current[choreId]) {
          return current;
        }
        return {
          ...current,
          [choreId]: {
            canUndoCompletion: false,
          },
        };
      });
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

  function onToggleRowSelection(chore: ChoreRow, nextChecked: boolean) {
    if (!canManageBulkActionsForChore(chore)) {
      return;
    }
    setSelectedChoreStateById((current) => {
      const alreadySelected = Boolean(current[chore.id]);
      if (nextChecked && alreadySelected) {
        return current;
      }
      if (!nextChecked && !alreadySelected) {
        return current;
      }
      const next = { ...current };
      if (nextChecked) {
        next[chore.id] = { canUndoCompletion: canUndoCompletion(chore.status) };
      } else {
        delete next[chore.id];
      }
      return next;
    });
  }

  function onToggleSelectAllCurrentPage(nextChecked: boolean) {
    setSelectedChoreStateById((current) => {
      const next = { ...current };
      let changed = false;
      for (const chore of chores) {
        if (!canManageBulkActionsForChore(chore)) {
          continue;
        }
        const isSelected = Boolean(next[chore.id]);
        if (nextChecked && !isSelected) {
          next[chore.id] = { canUndoCompletion: canUndoCompletion(chore.status) };
          changed = true;
        } else if (!nextChecked && isSelected) {
          delete next[chore.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  async function onBulkAction(action: "delete" | "undo_complete", choreIds: string[]) {
    if (hasBusyAction || choreIds.length === 0) {
      return;
    }
    setBulkActionState({
      action,
      total: choreIds.length,
      completed: 0,
    });
    setActionError("");
    let completedCount = 0;
    let failedCount = 0;
    for (const choreId of choreIds) {
      try {
        if (action === "delete") {
          const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
          }
        } else {
          const response = await fetch(`/api/chores/${choreId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "undo_complete" }),
          });
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? `UNDO_COMPLETE_HTTP_${response.status}`);
          }
        }
        completedCount += 1;
      } catch {
        failedCount += 1;
      } finally {
        setBulkActionState((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            completed: current.completed + 1,
          };
        });
      }
    }
    if (action === "delete") {
      const deletedIds = new Set(choreIds);
      setSelectedChoreStateById((current) => {
        let changed = false;
        const next: Record<string, SelectedChoreState> = {};
        for (const [choreId, value] of Object.entries(current)) {
          if (deletedIds.has(choreId)) {
            changed = true;
            continue;
          }
          next[choreId] = value;
        }
        return changed ? next : current;
      });
    } else {
      const undoneIds = new Set(choreIds);
      setSelectedChoreStateById((current) => {
        let changed = false;
        const next: Record<string, SelectedChoreState> = {};
        for (const [choreId, value] of Object.entries(current)) {
          if (undoneIds.has(choreId)) {
            next[choreId] = { canUndoCompletion: false };
            if (value.canUndoCompletion) {
              changed = true;
            }
            continue;
          }
          next[choreId] = value;
        }
        return changed ? next : current;
      });
      if (completedCount > 0 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    }
    await loadChores({ silent: true });
    if (failedCount > 0) {
      setActionError(
        action === "delete"
          ? `bulk_delete_failed_${failedCount}`
          : `bulk_undo_complete_failed_${failedCount}`,
      );
    }
    setBulkActionState(null);
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
                    categoryIds: editingChore.categoryIds,
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
          <div className="page-header-row">
            <div className="page-header-inline">
              <BackLink className="page-back-link" />
              <h1>All Chores</h1>
            </div>
          </div>
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
                  <div className="family-page-subhead chores-table-subhead">
                    <p className="small chores-table-total">
                      {total} chore{total === 1 ? "" : "s"}
                    </p>
                    {selectedCount > 0 ? (
                      <div className="chores-table-bulk-actions">
                        <span className="small chores-table-selected-count">
                          {selectedCount} selected
                          {bulkActionState ? ` (${bulkActionState.completed}/${bulkActionState.total})` : ""}
                        </span>
                        <BulkActionsMenu
                          disabled={hasBusyAction}
                          selectedUndoCount={selectedUndoCount}
                          busyAction={bulkActionState?.action ?? ""}
                          onDeleteRequested={() => setPendingBulkDeleteOpen(true)}
                          onUndoCompletion={() =>
                            void onBulkAction(
                              "undo_complete",
                              Object.entries(selectedChoreStateById)
                                .filter(([, entry]) => entry.canUndoCompletion)
                                .map(([choreId]) => choreId),
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="family-table-wrap">
                    <table className="family-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              ref={selectAllRef}
                              type="checkbox"
                              aria-label="Select all chores on this page"
                              checked={allSelectableOnPageSelected}
                              disabled={selectableChoreIdsOnPage.length === 0 || hasBusyAction}
                              onChange={(event) => onToggleSelectAllCurrentPage(event.target.checked)}
                            />
                          </th>
                          <th>
                            <button type="button" className="table-sort-btn" onClick={() => onSort("title")}>
                              {sortLabel("title", "Title")}
                            </button>
                          </th>
                          <th>Categories</th>
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
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select chore ${chore.title}`}
                                checked={Boolean(selectedChoreStateById[chore.id])}
                                disabled={!canManageBulkActionsForChore(chore) || hasBusyAction}
                                onChange={(event) => onToggleRowSelection(chore, event.target.checked)}
                              />
                            </td>
                            <td>
                              <span className="table-chore-title-cell">
                                <span>{chore.title}</span>
                                {viewerGoogleTasksLinked && chore.source === "google_tasks" ? (
                                  <GoogleTaskSyncIndicator className="table-chore-sync-indicator" />
                                ) : null}
                              </span>
                            </td>
                            <td>
                              <ChoreCategoriesChip categories={chore.categories ?? []} />
                            </td>
                            <td>
                              <EnumChip
                                label={getStatusLabel(chore.status)}
                                tone={statusTone(chore.status)}
                              />
                            </td>
                            <td>
                              <span className="table-assignee-cell">
                                <Avatar
                                  className="table-assignee-avatar"
                                  size={28}
                                  borderWidth={1}
                                  name={chore.assigneeName || "Assignee"}
                                  avatarId={chore.assigneeAvatarId}
                                  photoUrl={chore.assigneeAvatarPhotoUrl}
                                  ariaHidden
                                  referrerPolicy="no-referrer"
                                />
                                <span>{chore.assigneeName || "-"}</span>
                              </span>
                            </td>
                            <td>{chore.dueDate || "-"}</td>
                            <td>{formatCompletedDate(chore.completedAt)}</td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                                <CoinIcon size={16} />
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
                                disabled={hasBusyAction}
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
                  disabled={hasBusyAction}
                  onClick={() => setPendingDeleteChore(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  disabled={hasBusyAction}
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
      <ModalShell
        open={pendingBulkDeleteOpen}
        onRequestClose={() => setPendingBulkDeleteOpen(false)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 className="mb-2 text-lg font-bold text-slate-800">Delete Selected Chores</h3>
          <p className="mb-4 text-sm text-slate-600">
            Delete <strong>{selectedCount}</strong> selected chore{selectedCount === 1 ? "" : "s"}?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              disabled={hasBusyAction}
              onClick={() => setPendingBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
              disabled={hasBusyAction}
              onClick={async () => {
                await onBulkAction("delete", Object.keys(selectedChoreStateById));
                setPendingBulkDeleteOpen(false);
              }}>
              {bulkActionState?.action === "delete" ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </ModalShell>
    </>
  );
}









