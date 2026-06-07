"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddEditChoresDialog, FAMILY_ASSIGNEE_OPTION_ID } from "@/components/add-edit-chores-dialog";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ChipOverflowRow } from "@/components/chip-overflow-row";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { EnumChip } from "@/components/enum-chip";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import type {
  ChoreRecurrenceType,
  ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";
import type { ChoreType } from "@/lib/chores/types";
import { parseCompletionWindow } from "@/lib/preferences/completion-window";
import { useMarkDiscoverySeen } from "@/lib/hooks/use-discovery";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";

type ChoreCategory = {
  id: string;
  name: string;
  color: string;
};

type ChoreRow = {
  id: string;
  title: string;
  choreType?: ChoreType;
  status: string;
  source?: "manual" | "google_tasks";
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  assigneePrimaryColor?: string;
  details?: string;
  dueDate: string;
  categoryIds?: string[];
  categories?: ChoreCategory[];
  completedAt?: string;
  coinValue: number;
  requireApproval?: boolean;
  recurrenceType?: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  createdAt?: string;
};

type ChoresResponse = {
  chores: ChoreRow[];
  assigneeDirectory?: Array<{
    id: string;
    name: string;
    avatarId?: string;
    avatarPhotoUrl?: string;
    primaryColor?: string;
  }>;
  familyCategories?: ChoreCategory[];
  totalUnfiltered?: number;
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

type ColumnKey =
  | "categories"
  | "status"
  | "assignee"
  | "type"
  | "due"
  | "completed"
  | "coins"
  | "recurrence"
  | "approval";

// Title is always shown (it is the row's primary label); these are the columns
// the viewer can toggle on/off from the column-visibility menu.
const TOGGLEABLE_COLUMNS: ColumnKey[] = [
  "categories",
  "status",
  "assignee",
  "type",
  "due",
  "completed",
  "coins",
  "recurrence",
  "approval",
];

type ColumnFilterState = {
  categoryIds: string[];
  choreTypes: ChoreType[];
  recurrenceTypes: ChoreRecurrenceType[];
  requireApproval: "" | "yes" | "no";
  coinMin: string;
  coinMax: string;
  dueFrom: string;
  dueTo: string;
  completedFrom: string;
  completedTo: string;
};

const EMPTY_COLUMN_FILTERS: ColumnFilterState = {
  categoryIds: [],
  choreTypes: [],
  recurrenceTypes: [],
  requireApproval: "",
  coinMin: "",
  coinMax: "",
  dueFrom: "",
  dueTo: "",
  completedFrom: "",
  completedTo: "",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const CHORES_PREFS_STORAGE_KEY = "chores.table.prefs.v1";
const CHORES_SAVED_VIEWS_KEY = "chores.savedViews.v1";
const CHORES_ACTIVE_FILTERS_KEY = "chores.activeFilters.v1";

function countActiveColumnFilters(filters: ColumnFilterState) {
  let count = 0;
  if (filters.categoryIds.length > 0) count += 1;
  if (filters.choreTypes.length > 0) count += 1;
  if (filters.recurrenceTypes.length > 0) count += 1;
  if (filters.requireApproval) count += 1;
  if (filters.coinMin || filters.coinMax) count += 1;
  if (filters.dueFrom || filters.dueTo) count += 1;
  if (filters.completedFrom || filters.completedTo) count += 1;
  return count;
}

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

function getStatusLabel(
  chore: Pick<ChoreRow, "status" | "requireApproval">,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (chore.status === "Submitted" && chore.requireApproval) {
    return t("choresPage.status.awaitingApproval");
  }
  if (chore.status === "Submitted" || chore.status === "Approved") {
    return t("choresPage.status.completed");
  }
  if (chore.status === "Open") {
    return t("choresPage.status.open");
  }
  if (chore.status === "Rejected") {
    return t("choresPage.status.rejected");
  }
  return chore.status;
}

function statusTone(status: string): "blue" | "green" | "rose" | "slate" {
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

function formatCompletedDate(value: string | undefined, locale: string) {
  if (!value) {
    return "-";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleDateString(locale);
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

type ChoreStatusQuickFilter =
  | ""
  | "all"
  | "completed"
  | "needs_approval"
  | "open";

type SavedView = {
  id: string;
  name: string;
  columnFilters: ColumnFilterState;
  status: ChoreStatusQuickFilter;
  assigneeIds: string[];
};

type RouteFilterState = {
  assigneeIds: string[];
  status: ChoreStatusQuickFilter;
  completedWindow: ReturnType<typeof parseCompletionWindow>;
  tzOffsetMinutes: number | null;
};

function parseStatusQuickFilter(value: string | null): ChoreStatusQuickFilter {
  if (value === null) {
    return "open";
  }
  if (
    value === "all" ||
    value === "completed" ||
    value === "needs_approval" ||
    value === "open"
  ) {
    return value;
  }
  return "open";
}

function parseRouteFilters(search: string): RouteFilterState {
  const params = new URLSearchParams(search);
  const assigneeIds = Array.from(
    new Set(
      params
        .getAll("assigneeId")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  return {
    assigneeIds,
    status: parseStatusQuickFilter(params.get("status")),
    completedWindow: parseCompletionWindow(params.get("completedWindow")),
    tzOffsetMinutes: parseTimezoneOffsetMinutes(params.get("tzOffsetMinutes")),
  };
}

type RowActionState = {
  choreId: string;
  action: "delete" | "undo_complete" | "approve" | "reject";
};
type BulkActionState = {
  action: "delete" | "undo_complete" | "set_categories" | "approve";
  total: number;
  completed: number;
};

type SelectedChoreState = {
  canUndoCompletion: boolean;
  canApprove: boolean;
};

function normalizeAssigneeAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function canUndoCompletion(status: string) {
  return status === "Submitted" || status === "Approved" || status === "Rejected";
}

function canApproveChore(chore: Pick<ChoreRow, "status" | "requireApproval">) {
  return chore.status === "Submitted" && Boolean(chore.requireApproval);
}

function isMultiAssigneeChore(chore: Pick<ChoreRow, "assigneeScope" | "assigneeIds">) {
  return chore.assigneeScope === "family" || (chore.assigneeIds?.length ?? 0) > 1;
}

function getDisplayedCoinValue(chore: Pick<ChoreRow, "choreType" | "status" | "coinValue">) {
  if (chore.choreType === "see_and_do" && chore.status !== "Approved") {
    return "-";
  }
  return String(chore.coinValue ?? 0);
}

function getCoinTooltip(
  chore: Pick<ChoreRow, "choreType">,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (chore.choreType === "see_and_do") {
    return t("choresPage.coinTooltip.seeAndDo");
  }
  return undefined;
}

type ChoreActionsMenuProps = {
  chore: ChoreRow;
  canManageActions: boolean;
  busyAction: "" | "delete" | "undo_complete" | "approve" | "reject";
  disabled: boolean;
  onEdit: (chore: ChoreRow) => void;
  onDeleteRequested: (chore: ChoreRow) => void;
  onUndoCompletion: (choreId: string) => Promise<void> | void;
  onApprove: (chore: ChoreRow) => Promise<void> | void;
  onRejectRequested: (chore: ChoreRow) => void;
};

function ChoreActionsMenu({
  chore,
  canManageActions,
  busyAction,
  disabled,
  onEdit,
  onDeleteRequested,
  onUndoCompletion,
  onApprove,
  onRejectRequested,
}: ChoreActionsMenuProps) {
  const { t } = useLocale();
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
  const canApprove = chore.status === "Submitted" && Boolean(chore.requireApproval);
  const canReject = chore.status === "Submitted" && Boolean(chore.requireApproval);

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
        aria-label={t("choresPage.menu.choreOptions")}
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
                {t("common.actions.edit")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canApprove || disabled}
                onClick={() => {
                  setMenuOpen(false);
                  void onApprove(chore);
                }}>
                {busyAction === "approve"
                  ? t("choresPage.actions.approving")
                  : isMultiAssigneeChore(chore) || chore.choreType === "see_and_do"
                    ? t("choresPage.actions.approveWithEllipsis")
                    : t("choresPage.actions.approve")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canReject || disabled}
                onClick={() => {
                  setMenuOpen(false);
                  onRejectRequested(chore);
                }}>
                {busyAction === "reject" ? t("choresPage.actions.rejecting") : t("choresPage.actions.reject")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canUndoCompletion || disabled}
                onClick={() => {
                  setMenuOpen(false);
                  void onUndoCompletion(chore.id);
                }}>
                {busyAction === "undo_complete" ? t("choresPage.actions.undoing") : t("choresPage.actions.undoCompletion")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteRequested(chore);
                }}>
                {busyAction === "delete" ? t("choresPage.actions.deleting") : t("common.actions.delete")}
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
  selectedApproveCount: number;
  busyAction: "" | "delete" | "undo_complete" | "set_categories" | "approve";
  onDeleteRequested: () => void;
  onUndoCompletion: () => void;
  onApprove: () => void;
  canSetCategories: boolean;
  onSetCategoriesRequested: () => void;
};

function BulkActionsMenu({
  disabled,
  selectedUndoCount,
  selectedApproveCount,
  busyAction,
  onDeleteRequested,
  onUndoCompletion,
  onApprove,
  canSetCategories,
  onSetCategoriesRequested,
}: BulkActionsMenuProps) {
  const { t } = useLocale();
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
    const menuWidth = 196;
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
        aria-label={t("choresPage.menu.bulkActions")}
        aria-expanded={menuOpen}
        className="btn btn-secondary h-9 px-3 py-2 text-sm"
        disabled={disabled}
        onClick={() => setMenuOpen((current) => !current)}>
        {t("choresPage.bulkActions.label")}
      </Button>
      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[90] mt-1 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: menuPosition.top, left: menuPosition.left }}>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteRequested();
                }}>
                {busyAction === "delete" ? t("choresPage.actions.deleting") : t("common.actions.delete")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || selectedApproveCount <= 0}
                onClick={() => {
                  setMenuOpen(false);
                  onApprove();
                }}>
                {busyAction === "approve" ? t("choresPage.actions.approving") : t("choresPage.actions.approve")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || selectedUndoCount <= 0}
                onClick={() => {
                  setMenuOpen(false);
                  onUndoCompletion();
                }}>
                {busyAction === "undo_complete" ? t("choresPage.actions.undoing") : t("choresPage.actions.undoCompletion")}
              </Button>
              <Button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !canSetCategories}
                onClick={() => {
                  setMenuOpen(false);
                  onSetCategoriesRequested();
                }}>
                {busyAction === "set_categories" ? t("choresPage.actions.applying") : t("choresPage.bulkActions.setCategories")}
              </Button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
export default function ChoresPage() {
  const { locale, t } = useLocale();
  // Visiting the full chores page counts as viewing the Chores discovery section.
  useMarkDiscoverySeen(["chores"], true);
  const [chores, setChores] = useState<ChoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [rowActionState, setRowActionState] = useState<RowActionState | null>(null);
  const [editingChore, setEditingChore] = useState<ChoreRow | null>(null);
  const [pendingDeleteChore, setPendingDeleteChore] = useState<ChoreRow | null>(null);
  const [pendingRejectChore, setPendingRejectChore] = useState<ChoreRow | null>(null);
  const [pendingApproveChore, setPendingApproveChore] = useState<ChoreRow | null>(null);
  const [approvalCoinsByAssignee, setApprovalCoinsByAssignee] = useState<Record<string, number>>({});
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [pendingBulkDeleteOpen, setPendingBulkDeleteOpen] = useState(false);
  const [pendingBulkSetCategoriesOpen, setPendingBulkSetCategoriesOpen] = useState(false);
  const [bulkCategoryIds, setBulkCategoryIds] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<ChoreCategory[]>([]);
  const [viewerUid, setViewerUid] = useState("");
  const [viewerAssigneeAliases, setViewerAssigneeAliases] = useState<string[]>([]);
  const [assigneeDirectoryByAlias, setAssigneeDirectoryByAlias] = useState<
    Record<string, { name: string; avatarId?: string; avatarPhotoUrl?: string; primaryColor?: string }>
  >({});
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [total, setTotal] = useState(0);
  const [totalUnfiltered, setTotalUnfiltered] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilterState>(() => {
    if (typeof window === "undefined") {
      return EMPTY_COLUMN_FILTERS;
    }
    try {
      const raw = window.localStorage.getItem(CHORES_ACTIVE_FILTERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { columnFilters?: Partial<ColumnFilterState> };
        if (parsed?.columnFilters && typeof parsed.columnFilters === "object") {
          return { ...EMPTY_COLUMN_FILTERS, ...parsed.columnFilters };
        }
      }
    } catch {
      // ignore
    }
    return EMPTY_COLUMN_FILTERS;
  });
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(() => new Set());
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(CHORES_SAVED_VIEWS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed as SavedView[];
        }
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const saveViewInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedChoreStateById, setSelectedChoreStateById] = useState<Record<string, SelectedChoreState>>({});
  const [bulkActionState, setBulkActionState] = useState<BulkActionState | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<ChoreSortBy>("completedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [realtimeContext, setRealtimeContext] = useState<{ familyId: string; authToken: string } | null>(null);
  const canCreateChores = viewerRole === "admin" || viewerRole === "player";
  const playerSeeAndDoMode = viewerRole === "player";
  const requestSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const shouldApplySearch = query.trim().length >= 3;
  const [routeFilters, setRouteFilters] = useState<RouteFilterState>(() => {
    if (typeof window === "undefined") {
      return {
        assigneeIds: [],
        status: "open",
        completedWindow: null,
        tzOffsetMinutes: null,
      };
    }
    const urlParsed = parseRouteFilters(window.location.search);
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("status") || urlParams.has("assigneeId")) {
      return urlParsed;
    }
    try {
      const raw = window.localStorage.getItem(CHORES_ACTIVE_FILTERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { status?: ChoreStatusQuickFilter; assigneeIds?: string[] };
        if (parsed?.status) {
          return {
            ...urlParsed,
            status: parsed.status,
            assigneeIds: Array.isArray(parsed.assigneeIds) ? parsed.assigneeIds : [],
          };
        }
      }
    } catch {
      // ignore
    }
    return urlParsed;
  });
  const assigneeIdFilters = routeFilters.assigneeIds;
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
  const selectedApproveCount = useMemo(
    () => Object.values(selectedChoreStateById).filter((entry) => entry.canApprove).length,
    [selectedChoreStateById],
  );
  const categorySelectOptions = useMemo<TailwindSelectOption[]>(
    () => availableCategories.map((category) => ({ value: category.id, label: category.name })),
    [availableCategories],
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
      for (const assigneeId of assigneeIdFilters) {
        params.append("assigneeId", assigneeId);
      }
      if (statusFilter && statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      params.set("tzOffsetMinutes", String(completionFilterTimezoneOffset));
      if (completedWindowFilter) {
        params.set("completedWindow", completedWindowFilter);
      }
      for (const categoryId of columnFilters.categoryIds) {
        params.append("categoryId", categoryId);
      }
      for (const choreType of columnFilters.choreTypes) {
        params.append("choreType", choreType);
      }
      for (const recurrenceType of columnFilters.recurrenceTypes) {
        params.append("recurrenceType", recurrenceType);
      }
      if (columnFilters.requireApproval) {
        params.set("requireApproval", columnFilters.requireApproval);
      }
      if (columnFilters.coinMin.trim()) {
        params.set("coinMin", columnFilters.coinMin.trim());
      }
      if (columnFilters.coinMax.trim()) {
        params.set("coinMax", columnFilters.coinMax.trim());
      }
      if (columnFilters.dueFrom) {
        params.set("dueFrom", columnFilters.dueFrom);
      }
      if (columnFilters.dueTo) {
        params.set("dueTo", columnFilters.dueTo);
      } else if (statusFilter === "open") {
        const now = new Date();
        const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        params.set("dueTo", localToday);
      }
      if (columnFilters.completedFrom) {
        params.set("completedFrom", columnFilters.completedFrom);
      }
      if (columnFilters.completedTo) {
        params.set("completedTo", columnFilters.completedTo);
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
      setViewerAssigneeAliases(payload.viewerAssigneeAliases ?? []);
      const nextDirectory: Record<string, { name: string; avatarId?: string; avatarPhotoUrl?: string; primaryColor?: string }> = {};
      for (const entry of payload.assigneeDirectory ?? []) {
        nextDirectory[entry.id] = {
          name: entry.name,
          avatarId: entry.avatarId,
          avatarPhotoUrl: entry.avatarPhotoUrl,
          primaryColor: entry.primaryColor,
        };
      }
      setAssigneeDirectoryByAlias(nextDirectory);
      setAvailableCategories(payload.familyCategories ?? []);
      setPage(payload.pagination?.page ?? targetPage);
      setTotal(payload.pagination?.total ?? payload.chores.length ?? 0);
      setTotalUnfiltered(payload.totalUnfiltered ?? payload.pagination?.total ?? payload.chores.length ?? 0);
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
      if (!silent && requestSeq === requestSeqRef.current && !controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [
    assigneeIdFilters,
    columnFilters,
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
        const nextCanApprove = canApproveChore(chore);
        if (
          next[chore.id].canUndoCompletion !== nextCanUndo ||
          next[chore.id].canApprove !== nextCanApprove
        ) {
          next[chore.id] = { canUndoCompletion: nextCanUndo, canApprove: nextCanApprove };
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

  // Status, assignee and the completed-date window are mirrored to the URL so
  // dashboard deep-links keep working and quick filters survive a refresh.
  const applyRouteFilters = useCallback(
    (patch: Partial<Pick<RouteFilterState, "status" | "assigneeIds" | "completedWindow">>) => {
      if (typeof window === "undefined") {
        return;
      }
      const current = parseRouteFilters(window.location.search);
      const merged = {
        status: patch.status !== undefined ? patch.status : current.status,
        assigneeIds: patch.assigneeIds !== undefined ? patch.assigneeIds : current.assigneeIds,
        completedWindow:
          patch.completedWindow !== undefined ? patch.completedWindow : current.completedWindow,
      };
      if (merged.status !== "completed") {
        merged.completedWindow = null;
      }
      const params = new URLSearchParams(window.location.search);
      if (merged.status) {
        params.set("status", merged.status);
      } else {
        params.delete("status");
      }
      params.delete("assigneeId");
      for (const assigneeId of merged.assigneeIds) {
        if (assigneeId) {
          params.append("assigneeId", assigneeId);
        }
      }
      if (merged.completedWindow) {
        params.set("completedWindow", merged.completedWindow);
      } else {
        params.delete("completedWindow");
        params.delete("tzOffsetMinutes");
      }
      const nextSearch = params.toString();
      window.history.pushState({}, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
      setRouteFilters(parseRouteFilters(window.location.search));
      setPage(1);
    },
    [],
  );

  const updateColumnFilters = useCallback((patch: Partial<ColumnFilterState>) => {
    setColumnFilters((current) => ({ ...current, ...patch }));
    setActiveViewId(null);
    setPage(1);
  }, []);

  const toggleColumnFilterValue = useCallback(
    <T extends string>(key: "categoryIds" | "choreTypes" | "recurrenceTypes", value: T) => {
      setColumnFilters((current) => {
        const values = current[key] as T[];
        const nextValues = values.includes(value)
          ? values.filter((entry) => entry !== value)
          : [...values, value];
        return { ...current, [key]: nextValues };
      });
      setActiveViewId(null);
      setPage(1);
    },
    [],
  );

  const resetAllFilters = useCallback(() => {
    setSearchInput("");
    setColumnFilters(EMPTY_COLUMN_FILTERS);
    setActiveViewId(null);
    applyRouteFilters({ status: "", assigneeIds: [], completedWindow: null });
  }, [applyRouteFilters]);

  const applyView = useCallback(
    (view: SavedView) => {
      setColumnFilters(view.columnFilters);
      applyRouteFilters({ status: view.status, assigneeIds: view.assigneeIds });
      setActiveViewId(view.id);
      setPage(1);
    },
    [applyRouteFilters],
  );

  const deleteView = useCallback((viewId: string) => {
    setSavedViews((current) => current.filter((v) => v.id !== viewId));
    setActiveViewId((current) => (current === viewId ? null : current));
  }, []);

  const handleSaveView = useCallback(() => {
    const name = saveViewName.trim();
    if (!name) {
      return;
    }
    const newView: SavedView = {
      id: `view_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name,
      columnFilters,
      status: statusFilter,
      assigneeIds: assigneeIdFilters,
    };
    setSavedViews((current) => [...current, newView]);
    setActiveViewId(newView.id);
    setSaveViewOpen(false);
    setSaveViewName("");
  }, [assigneeIdFilters, columnFilters, saveViewName, statusFilter]);

  const statusChipItems = useMemo(() => {
    const items: Array<{ id: string; label: string; active: boolean; onSelect: () => void }> = [
      {
        id: "open",
        label: t("choresPage.filters.open"),
        active: statusFilter === "open",
        onSelect: () => { setActiveViewId(null); applyRouteFilters({ status: "open" }); },
      },
      {
        id: "all",
        label: t("choresPage.filters.all"),
        active: statusFilter === "all" || statusFilter === "",
        onSelect: () => { setActiveViewId(null); applyRouteFilters({ status: "all" }); },
      },
    ];
    if (viewerRole === "admin") {
      items.push({
        id: "needs_approval",
        label: t("choresPage.filters.needsApproval"),
        active: statusFilter === "needs_approval",
        onSelect: () => { setActiveViewId(null); applyRouteFilters({ status: "needs_approval" }); },
      });
    }
    items.push({
      id: "completed",
      label: t("choresPage.filters.completed"),
      active: statusFilter === "completed",
      onSelect: () => { setActiveViewId(null); applyRouteFilters({ status: "completed" }); },
    });
    return items;
  }, [applyRouteFilters, statusFilter, t, viewerRole]);

  // Restore persisted column/density/page-size preferences on mount.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(CHORES_PREFS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        hiddenColumns?: unknown;
        density?: unknown;
        pageSize?: unknown;
      };
      if (Array.isArray(parsed.hiddenColumns)) {
        setHiddenColumns(
          new Set(
            parsed.hiddenColumns.filter((key): key is ColumnKey =>
              TOGGLEABLE_COLUMNS.includes(key as ColumnKey),
            ),
          ),
        );
      }
      if (parsed.density === "compact" || parsed.density === "comfortable") {
        setDensity(parsed.density);
      }
      if (typeof parsed.pageSize === "number" && PAGE_SIZE_OPTIONS.includes(parsed.pageSize)) {
        setPageSize(parsed.pageSize);
      }
    } catch {
      // Ignore malformed preferences.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        CHORES_PREFS_STORAGE_KEY,
        JSON.stringify({
          hiddenColumns: Array.from(hiddenColumns),
          density,
          pageSize,
        }),
      );
    } catch {
      // Storage may be unavailable (private mode); preferences are best-effort.
    }
  }, [hiddenColumns, density, pageSize]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        CHORES_ACTIVE_FILTERS_KEY,
        JSON.stringify({
          columnFilters,
          status: statusFilter,
          assigneeIds: assigneeIdFilters,
          activeViewId,
        }),
      );
    } catch {
      // Storage may be unavailable.
    }
  }, [activeViewId, assigneeIdFilters, columnFilters, statusFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(CHORES_SAVED_VIEWS_KEY, JSON.stringify(savedViews));
    } catch {
      // Storage may be unavailable.
    }
  }, [savedViews]);

  useEffect(() => {
    if (saveViewOpen && saveViewInputRef.current) {
      saveViewInputRef.current.focus();
    }
  }, [saveViewOpen]);

  const activeColumnFilterCount = countActiveColumnFilters(columnFilters);
  const hasAnyActiveFilter =
    activeColumnFilterCount > 0 ||
    (statusFilter !== "" && statusFilter !== "open") ||
    assigneeIdFilters.length > 0 ||
    Boolean(completedWindowFilter) ||
    shouldApplySearch;
  const isColumnVisible = useCallback(
    (key: ColumnKey) => !hiddenColumns.has(key),
    [hiddenColumns],
  );
  const toggleColumn = useCallback((key: ColumnKey) => {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const assigneeSelectOptions = useMemo<TailwindSelectOption[]>(
    () => [
      {
        value: FAMILY_ASSIGNEE_OPTION_ID,
        label: t("choresPage.filterPanel.familyAssignee"),
        leading: (
          <FamilyMemberAvatar
            className="today-chores-family-avatar"
            name={t("choresPage.filterPanel.familyAssignee")}
            size={26}
            borderWidth={2}
            isFamily
            ariaHidden
          />
        ),
      },
      ...Object.entries(assigneeDirectoryByAlias)
        .map(([id, entry]) => ({
          value: id,
          label: entry.name,
          leading: (
            <FamilyMemberAvatar
              className="completion-chart-avatar today-chores-scope-avatar"
              name={entry.name}
              avatarId={entry.avatarId}
              avatarPhotoUrl={entry.avatarPhotoUrl}
              primaryColor={entry.primaryColor}
              size={26}
              borderWidth={2}
              ariaHidden
            />
          ),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [assigneeDirectoryByAlias, t],
  );
  const choreTypeCheckboxOptions = useMemo<Array<{ value: ChoreType; label: string }>>(
    () => [
      { value: "normal", label: t("choresPage.choreType.normal") },
      { value: "group", label: t("choresPage.choreType.group") },
      { value: "see_and_do", label: t("choresPage.choreType.seeAndDo") },
    ],
    [t],
  );
  const recurrenceCheckboxOptions = useMemo<Array<{ value: ChoreRecurrenceType; label: string }>>(
    () => (["instant", "daily", "weekly", "monthly", "custom"] as const).map((value) => ({
      value,
      label: value === "custom" ? t("choresPage.recurrence.customFilter") : t(`choresPage.recurrence.${value}`),
    })),
    [t],
  );
  const approvalSelectOptions = useMemo<TailwindSelectOption[]>(
    () => [
      { value: "", label: t("choresPage.filterPanel.anyApproval") },
      { value: "yes", label: t("choresPage.filterPanel.approvalRequired") },
      { value: "no", label: t("choresPage.filterPanel.approvalNotRequired") },
    ],
    [t],
  );

  const choreTypeLabel = useCallback(
    (choreType?: ChoreType) => {
      if (choreType === "group") {
        return t("choresPage.choreType.group");
      }
      if (choreType === "see_and_do") {
        return t("choresPage.choreType.seeAndDo");
      }
      return t("choresPage.choreType.normal");
    },
    [t],
  );

  const recurrenceDisplay = useCallback(
    (chore: ChoreRow) => {
      const type = chore.recurrenceType ?? "none";
      if (type === "none") {
        return "-";
      }
      if (type === "custom") {
        const interval = Math.max(1, chore.recurrenceInterval ?? 1);
        const unit = chore.recurrenceUnit ?? "day";
        return t("choresPage.recurrence.custom", { interval, unit });
      }
      return t(`choresPage.recurrence.${type}`);
    },
    [t],
  );

  const firstRowIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRowIndex = total === 0 ? 0 : firstRowIndex + chores.length - 1;

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
            canApprove: false,
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

  async function onApproveChore(chore: ChoreRow) {
    const choreId = chore.id;
    if (hasBusyAction) {
      return;
    }
    if (isMultiAssigneeChore(chore) || chore.choreType === "see_and_do") {
      const assigneeIds =
        chore.assigneeIds && chore.assigneeIds.length > 0
          ? chore.assigneeIds
          : chore.assigneeId
            ? [chore.assigneeId]
            : [];
      const defaultCoins =
        assigneeIds.length > 0 ? Math.ceil((chore.coinValue ?? 0) / assigneeIds.length) : chore.coinValue ?? 0;
      const next: Record<string, number> = {};
      for (const assigneeId of assigneeIds) {
        next[assigneeId] = defaultCoins;
      }
      setApprovalCoinsByAssignee(next);
      setPendingApproveChore(chore);
      return;
    }
    setRowActionState({ choreId, action: "approve" });
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `APPROVE_HTTP_${response.status}`);
      }
      await loadChores({ silent: true });
      setSelectedChoreStateById((current) => {
        if (!current[choreId]) {
          return current;
        }
        return {
          ...current,
          [choreId]: {
            canUndoCompletion: true,
            canApprove: false,
          },
        };
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    } catch (approveError) {
      const message =
        approveError instanceof Error ? approveError.message : "approve_chore_failed";
      setActionError(message);
    } finally {
      setRowActionState(null);
    }
  }

  async function onApproveWithOverrides() {
    if (!pendingApproveChore || hasBusyAction) {
      return;
    }
    const choreId = pendingApproveChore.id;
    setRowActionState({ choreId, action: "approve" });
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          approvalPayouts: Object.entries(approvalCoinsByAssignee).map(([assigneeId, coinValue]) => ({
            assigneeId,
            coinValue: Math.max(0, Math.trunc(Number(coinValue) || 0)),
          })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `APPROVE_HTTP_${response.status}`);
      }
      setPendingApproveChore(null);
      setApprovalCoinsByAssignee({});
      await loadChores({ silent: true });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("wallet:refresh"));
      }
    } catch (approveError) {
      const message =
        approveError instanceof Error ? approveError.message : "approve_chore_failed";
      setActionError(message);
    } finally {
      setRowActionState(null);
    }
  }

  async function onRejectChore(choreId: string, feedback: string) {
    if (hasBusyAction) {
      return false;
    }
    setRowActionState({ choreId, action: "reject" });
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", feedback }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REJECT_HTTP_${response.status}`);
      }
      await loadChores({ silent: true });
      setSelectedChoreStateById((current) => {
        if (!current[choreId]) {
          return current;
        }
        return {
          ...current,
          [choreId]: {
            canUndoCompletion: true,
            canApprove: false,
          },
        };
      });
      return true;
    } catch (rejectError) {
      const message =
        rejectError instanceof Error ? rejectError.message : "reject_chore_failed";
      setActionError(message);
      return false;
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
        next[chore.id] = {
          canUndoCompletion: canUndoCompletion(chore.status),
          canApprove: canApproveChore(chore),
        };
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
          next[chore.id] = {
            canUndoCompletion: canUndoCompletion(chore.status),
            canApprove: canApproveChore(chore),
          };
          changed = true;
        } else if (!nextChecked && isSelected) {
          delete next[chore.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  async function onBulkAction(action: "delete" | "undo_complete" | "approve", choreIds: string[]) {
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
        } else if (action === "undo_complete") {
          const response = await fetch(`/api/chores/${choreId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "undo_complete" }),
          });
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? `UNDO_COMPLETE_HTTP_${response.status}`);
          }
        } else {
          const response = await fetch(`/api/chores/${choreId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve" }),
          });
          if (!response.ok) {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? `APPROVE_HTTP_${response.status}`);
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
      const changedIds = new Set(choreIds);
      setSelectedChoreStateById((current) => {
        let changed = false;
        const next: Record<string, SelectedChoreState> = {};
        for (const [choreId, value] of Object.entries(current)) {
          if (changedIds.has(choreId)) {
            next[choreId] = { canUndoCompletion: action === "approve", canApprove: false };
            if (value.canUndoCompletion || value.canApprove) {
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
          : action === "undo_complete"
            ? `bulk_undo_complete_failed_${failedCount}`
            : `bulk_approve_failed_${failedCount}`,
      );
    }
    setBulkActionState(null);
  }

  async function onBulkSetCategories(choreIds: string[], nextCategoryIds: string[]) {
    if (hasBusyAction || choreIds.length === 0) {
      return;
    }
    setBulkActionState({
      action: "set_categories",
      total: choreIds.length,
      completed: 0,
    });
    setActionError("");
    let failedCount = 0;
    for (const choreId of choreIds) {
      try {
        const response = await fetch(`/api/chores/${choreId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_categories", categoryIds: nextCategoryIds }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `SET_CATEGORY_HTTP_${response.status}`);
        }
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
    await loadChores({ silent: true });
    if (failedCount > 0) {
      setActionError(`bulk_set_categories_failed_${failedCount}`);
    }
    setBulkActionState(null);
  }

  return (
    <>
      <main className="family-page">
          <AddEditChoresDialog
            chore={
              editingChore
                ? {
                    id: editingChore.id,
                    title: editingChore.title,
                    assigneeId: editingChore.assigneeId,
                    assigneeIds: editingChore.assigneeIds,
                    assigneeScope: editingChore.assigneeScope,
                    assigneeName: editingChore.assigneeName,
                    source: editingChore.source,
                    dueDate: editingChore.dueDate,
                    details: editingChore.details,
                    categoryIds: editingChore.categoryIds,
                    coinValue: editingChore.coinValue,
                    requireApproval: editingChore.requireApproval,
                    recurrenceType: editingChore.recurrenceType,
                    recurrenceInterval: editingChore.recurrenceInterval,
                    recurrenceUnit: editingChore.recurrenceUnit,
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
          <section className="family-page-card chores-controls-card" aria-label={t("choresPage.controls.ariaLabel")}>
            <div className="chores-controls-search-row">
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t("choresPage.controls.searchPlaceholder")}
                className="table-search-input chores-controls-search-input"
                aria-label={t("choresPage.controls.search")}
              />
              <Button
                type="button"
                className={`btn btn-secondary chores-controls-toggle${filterPanelOpen ? " is-active" : ""}`}
                aria-expanded={filterPanelOpen}
                onClick={() => setFilterPanelOpen((current) => !current)}>
                {t("choresPage.controls.filters")}
                {activeColumnFilterCount > 0 ? (
                  <span className="chores-filter-badge">{activeColumnFilterCount}</span>
                ) : null}
              </Button>
              <details className="chores-columns-menu">
                <summary className="btn btn-secondary chores-controls-toggle">
                  {t("choresPage.columns.label")}
                </summary>
                <div className="chores-columns-popover">
                  {TOGGLEABLE_COLUMNS.map((key) => (
                    <label key={key} className="chores-columns-option">
                      <input
                        type="checkbox"
                        checked={isColumnVisible(key)}
                        onChange={() => toggleColumn(key)}
                      />
                      {t(`choresPage.columns.${key}`)}
                    </label>
                  ))}
                </div>
              </details>
              <div className="chores-density-toggle" role="group" aria-label={t("choresPage.density.label")}>
                <Button
                  type="button"
                  className={`chores-density-btn${density === "comfortable" ? " is-active" : ""}`}
                  aria-pressed={density === "comfortable"}
                  onClick={() => setDensity("comfortable")}>
                  {t("choresPage.density.comfortable")}
                </Button>
                <Button
                  type="button"
                  className={`chores-density-btn${density === "compact" ? " is-active" : ""}`}
                  aria-pressed={density === "compact"}
                  onClick={() => setDensity("compact")}>
                  {t("choresPage.density.compact")}
                </Button>
              </div>
            </div>
            <div className="chores-controls-option-row">
              <p className="chores-controls-label">{t("choresPage.controls.filters")}</p>
              <div className="chores-quick-filter-row">
                <TailwindMultiSelect
                  ariaLabel={t("choresPage.columns.assignee")}
                  values={assigneeIdFilters}
                  onChange={(values) => {
                    setActiveViewId(null);
                    const nextValues = values.includes(FAMILY_ASSIGNEE_OPTION_ID)
                      ? values.filter((value) => value === FAMILY_ASSIGNEE_OPTION_ID)
                      : values;
                    applyRouteFilters({ assigneeIds: nextValues });
                  }}
                  options={assigneeSelectOptions}
                  placeholder={t("choresPage.filterPanel.allAssignees")}
                  selectedSummaryLabel={(count) =>
                    t("choresPage.filterPanel.selectedAssignees", { count })
                  }
                  className="chores-assignee-filter-select"
                />
                <ChipOverflowRow items={statusChipItems} />
                {savedViews.map((view) => (
                  <div
                    key={view.id}
                    className={`chores-saved-view-chip${activeViewId === view.id ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className="chores-saved-view-chip-label"
                      onClick={() => applyView(view)}>
                      {view.name}
                    </button>
                    <button
                      type="button"
                      className="chores-saved-view-chip-remove"
                      aria-label={`Remove ${view.name}`}
                      onClick={() => deleteView(view.id)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {filterPanelOpen ? (
              <div className="chores-filter-panel">
                <div className="chores-filter-sections">
                  {categorySelectOptions.length > 0 ? (
                    <div className="chores-filter-section">
                      <span className="chores-filter-section-label">{t("choresPage.columns.categories")}</span>
                      <div className="chores-filter-pills">
                        {categorySelectOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`chores-filter-pill${columnFilters.categoryIds.includes(option.value) ? " is-active" : ""}`}
                            onClick={() => toggleColumnFilterValue("categoryIds", option.value)}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="chores-filter-section">
                    <span className="chores-filter-section-label">{t("choresPage.columns.type")}</span>
                    <div className="chores-filter-pills">
                      {choreTypeCheckboxOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`chores-filter-pill${columnFilters.choreTypes.includes(option.value) ? " is-active" : ""}`}
                          onClick={() => toggleColumnFilterValue("choreTypes", option.value)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chores-filter-section">
                    <span className="chores-filter-section-label">{t("choresPage.filters.recurring")}</span>
                    <div className="chores-filter-pills">
                      {recurrenceCheckboxOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`chores-filter-pill${columnFilters.recurrenceTypes.includes(option.value) ? " is-active" : ""}`}
                          onClick={() => toggleColumnFilterValue("recurrenceTypes", option.value)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chores-filter-section">
                    <span className="chores-filter-section-label">{t("choresPage.columns.approval")}</span>
                    <div className="chores-filter-pills">
                      {approvalSelectOptions.filter((o) => o.value !== "").map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`chores-filter-pill${columnFilters.requireApproval === option.value ? " is-active" : ""}`}
                          onClick={() =>
                            updateColumnFilters({
                              requireApproval: columnFilters.requireApproval === option.value
                                ? ""
                                : option.value as ColumnFilterState["requireApproval"],
                            })
                          }>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chores-filter-section chores-filter-section--range">
                    <span className="chores-filter-section-label">{t("choresPage.filterPanel.coinRange")}</span>
                    <div className="chores-filter-range">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={columnFilters.coinMin}
                        onChange={(event) => updateColumnFilters({ coinMin: event.target.value })}
                        placeholder={t("choresPage.filterPanel.min")}
                        aria-label={t("choresPage.filterPanel.coinMin")}
                        className="chores-filter-input"
                      />
                      <span className="chores-filter-range-sep">–</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={columnFilters.coinMax}
                        onChange={(event) => updateColumnFilters({ coinMax: event.target.value })}
                        placeholder={t("choresPage.filterPanel.max")}
                        aria-label={t("choresPage.filterPanel.coinMax")}
                        className="chores-filter-input"
                      />
                    </div>
                  </div>
                  <div className="chores-filter-section chores-filter-section--range">
                    <span className="chores-filter-section-label">{t("choresPage.filterPanel.dueRange")}</span>
                    <div className="chores-filter-range">
                      <input
                        type="date"
                        value={columnFilters.dueFrom}
                        onChange={(event) => updateColumnFilters({ dueFrom: event.target.value })}
                        aria-label={t("choresPage.filterPanel.dueFrom")}
                        className="chores-filter-input"
                      />
                      <span className="chores-filter-range-sep">–</span>
                      <input
                        type="date"
                        value={columnFilters.dueTo}
                        onChange={(event) => updateColumnFilters({ dueTo: event.target.value })}
                        aria-label={t("choresPage.filterPanel.dueTo")}
                        className="chores-filter-input"
                      />
                    </div>
                  </div>
                  <div className="chores-filter-section chores-filter-section--range">
                    <span className="chores-filter-section-label">{t("choresPage.filterPanel.completedRange")}</span>
                    <div className="chores-filter-range">
                      <input
                        type="date"
                        value={columnFilters.completedFrom}
                        onChange={(event) => updateColumnFilters({ completedFrom: event.target.value })}
                        aria-label={t("choresPage.filterPanel.completedFrom")}
                        className="chores-filter-input"
                      />
                      <span className="chores-filter-range-sep">–</span>
                      <input
                        type="date"
                        value={columnFilters.completedTo}
                        onChange={(event) => updateColumnFilters({ completedTo: event.target.value })}
                        aria-label={t("choresPage.filterPanel.completedTo")}
                        className="chores-filter-input"
                      />
                    </div>
                  </div>
                </div>
                <div className="chores-filter-panel-footer">
                  <div className="chores-filter-panel-footer-left">
                    {saveViewOpen ? (
                      <div className="chores-save-view-form">
                        <input
                          ref={saveViewInputRef}
                          type="text"
                          value={saveViewName}
                          onChange={(e) => setSaveViewName(e.target.value)}
                          placeholder={t("choresPage.filterPanel.viewNamePlaceholder")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveView();
                            if (e.key === "Escape") { setSaveViewOpen(false); setSaveViewName(""); }
                          }}
                          className="chores-save-view-input"
                        />
                        <Button
                          type="button"
                          className="btn btn-primary chores-save-view-confirm"
                          disabled={!saveViewName.trim()}
                          onClick={handleSaveView}>
                          {t("choresPage.filterPanel.saveView")}
                        </Button>
                        <Button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => { setSaveViewOpen(false); setSaveViewName(""); }}>
                          {t("common.actions.cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setSaveViewOpen(true)}>
                        {t("choresPage.filterPanel.saveAsView")}
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!hasAnyActiveFilter}
                    onClick={resetAllFilters}>
                    {t("choresPage.filterPanel.clearAll")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
          {isLoading ? (
            <section aria-label={t("choresPage.loading")} aria-hidden="true" className="space-y-3">
              <div className="family-skeleton-chip-row">
                <div className="family-skeleton family-skeleton-chip" />
                <div className="family-skeleton family-skeleton-chip" />
                <div className="family-skeleton family-skeleton-chip" />
              </div>
              <div className="space-y-3">
                <div className="family-skeleton family-skeleton-row" />
                <div className="family-skeleton family-skeleton-row" />
                <div className="family-skeleton family-skeleton-row" />
                <div className="family-skeleton family-skeleton-row" />
              </div>
            </section>
          ) : null}
          {!isLoading && loadError ? <Alert>{t("choresPage.loadError", { error: loadError })}</Alert> : null}
          {!isLoading && !loadError ? (
            <>
              {actionError ? <Alert className="mb-3">{t("choresPage.updateError", { error: actionError })}</Alert> : null}
              {chores.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="small">{t("choresPage.empty")}</p>
                  {canCreateChores ? (
                    <div className="chores-empty-cta">
                      <AddEditChoresDialog
                        createMode={playerSeeAndDoMode ? "see_and_do" : "default"}
                        triggerLabel={playerSeeAndDoMode ? t("choresPage.actions.addSeeAndDo") : t("choresPage.actions.letsAddSome")}
                        onSaved={() => loadChores({ silent: true })}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <section className="family-page-card chores-table-card" aria-label={t("choresPage.listAriaLabel")}>
                    <div className="family-page-card-header chores-table-subhead">
                      <div className="chores-table-stats">
                        <p className="small chores-table-total">
                          {t("choresPage.results.showing", {
                            from: firstRowIndex,
                            to: lastRowIndex,
                            total,
                          })}
                        </p>
                        {total !== totalUnfiltered ? (
                          <p className="small chores-table-filtered-note">
                            {t("choresPage.results.filteredFrom", { totalUnfiltered })}
                          </p>
                        ) : null}
                      </div>
                      {selectedCount > 0 ? (
                        <div className="chores-table-bulk-actions">
                          <span className="small chores-table-selected-count">
                            {t("choresPage.selected", { count: selectedCount })}
                            {bulkActionState ? ` (${bulkActionState.completed}/${bulkActionState.total})` : ""}
                          </span>
                          <BulkActionsMenu
                            disabled={hasBusyAction}
                            selectedUndoCount={selectedUndoCount}
                            selectedApproveCount={selectedApproveCount}
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
                            onApprove={() =>
                              void onBulkAction(
                                "approve",
                                Object.entries(selectedChoreStateById)
                                  .filter(([, entry]) => entry.canApprove)
                                  .map(([choreId]) => choreId),
                              )
                            }
                            canSetCategories={viewerRole === "admin"}
                            onSetCategoriesRequested={() => {
                              setBulkCategoryIds([]);
                              setPendingBulkSetCategoriesOpen(true);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                    {statusFilter === "needs_approval" ? (
                      <div className="chores-approval-banner">{t("choresPage.approvalQueue")}</div>
                    ) : null}
                    <div className="family-table-wrap">
                      <table
                        className={`family-table chores-table${density === "compact" ? " is-compact" : ""}`}>
                        <thead>
                          <tr>
                            <th className="chores-col-select">
                              <input
                                ref={selectAllRef}
                                type="checkbox"
                                aria-label={t("choresPage.selectAllAriaLabel")}
                                checked={allSelectableOnPageSelected}
                                disabled={selectableChoreIdsOnPage.length === 0 || hasBusyAction}
                                onChange={(event) => onToggleSelectAllCurrentPage(event.target.checked)}
                              />
                            </th>
                            <th aria-sort={sortBy === "title" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" className="table-sort-btn" onClick={() => onSort("title")}>
                                {sortLabel("title", t("choresPage.columns.title"))}
                              </button>
                            </th>
                            {isColumnVisible("categories") ? <th>{t("choresPage.columns.categories")}</th> : null}
                            {isColumnVisible("status") ? (
                              <th aria-sort={sortBy === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                <button type="button" className="table-sort-btn" onClick={() => onSort("status")}>
                                  {sortLabel("status", t("choresPage.columns.status"))}
                                </button>
                              </th>
                            ) : null}
                            {isColumnVisible("assignee") ? (
                              <th aria-sort={sortBy === "assigneeName" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                <button type="button" className="table-sort-btn" onClick={() => onSort("assigneeName")}>
                                  {sortLabel("assigneeName", t("choresPage.columns.assignee"))}
                                </button>
                              </th>
                            ) : null}
                            {isColumnVisible("type") ? <th>{t("choresPage.columns.type")}</th> : null}
                            {isColumnVisible("due") ? (
                              <th aria-sort={sortBy === "dueDate" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                <button type="button" className="table-sort-btn" onClick={() => onSort("dueDate")}>
                                  {sortLabel("dueDate", t("choresPage.columns.due"))}
                                </button>
                              </th>
                            ) : null}
                            {isColumnVisible("completed") ? (
                              <th aria-sort={sortBy === "completedAt" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                <button type="button" className="table-sort-btn" onClick={() => onSort("completedAt")}>
                                  {sortLabel("completedAt", t("choresPage.columns.completed"))}
                                </button>
                              </th>
                            ) : null}
                            {isColumnVisible("coins") ? (
                              <th aria-sort={sortBy === "coinValue" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                <button type="button" className="table-sort-btn" onClick={() => onSort("coinValue")}>
                                  {sortLabel("coinValue", t("choresPage.columns.coins"))}
                                </button>
                              </th>
                            ) : null}
                            {isColumnVisible("recurrence") ? <th>{t("choresPage.columns.recurrence")}</th> : null}
                            {isColumnVisible("approval") ? <th>{t("choresPage.columns.approval")}</th> : null}
                            <th className="chores-col-actions" aria-label={t("choresPage.columns.actions")} />
                          </tr>
                        </thead>
                        <tbody>
                          {chores.map((chore) => {
                            const selected = Boolean(selectedChoreStateById[chore.id]);
                            return (
                              <tr key={chore.id} className={selected ? "is-selected" : undefined}>
                                <td className="chores-col-select">
                                  <input
                                    type="checkbox"
                                    aria-label={t("choresPage.selectChoreAriaLabel", { title: chore.title })}
                                    checked={selected}
                                    disabled={!canManageBulkActionsForChore(chore) || hasBusyAction}
                                    onChange={(event) => onToggleRowSelection(chore, event.target.checked)}
                                  />
                                </td>
                                <td>
                                  <span className="table-chore-title-cell">
                                    <span className="chores-title-text" title={chore.title}>{chore.title}</span>
                                  </span>
                                </td>
                                {isColumnVisible("categories") ? (
                                  <td>
                                    <ChoreCategoriesChip categories={chore.categories ?? []} />
                                  </td>
                                ) : null}
                                {isColumnVisible("status") ? (
                                  <td>
                                    <EnumChip label={getStatusLabel(chore, t)} tone={statusTone(chore.status)} />
                                  </td>
                                ) : null}
                                {isColumnVisible("assignee") ? (
                                  <td>
                                    <span className="table-assignee-cell">
                                      <FamilyMemberAvatar
                                        className="table-assignee-avatar"
                                        size={28}
                                        borderWidth={1}
                                        name={chore.assigneeName || t("choresPage.familyMemberFallback")}
                                        avatarId={chore.assigneeAvatarId}
                                        avatarPhotoUrl={chore.assigneeAvatarPhotoUrl}
                                        isFamily={chore.assigneeScope === "family"}
                                        ariaHidden
                                      />
                                      <span>{chore.assigneeName || "-"}</span>
                                    </span>
                                  </td>
                                ) : null}
                                {isColumnVisible("type") ? <td>{choreTypeLabel(chore.choreType)}</td> : null}
                                {isColumnVisible("due") ? <td>{chore.dueDate || "-"}</td> : null}
                                {isColumnVisible("completed") ? (
                                  <td>{formatCompletedDate(chore.completedAt, locale)}</td>
                                ) : null}
                                {isColumnVisible("coins") ? (
                                  <td>
                                    <span className="chores-coin-cell" title={getCoinTooltip(chore, t)}>
                                      <CoinIcon size={16} />
                                      <span>{getDisplayedCoinValue(chore)}</span>
                                    </span>
                                  </td>
                                ) : null}
                                {isColumnVisible("recurrence") ? <td>{recurrenceDisplay(chore)}</td> : null}
                                {isColumnVisible("approval") ? (
                                  <td>
                                    {chore.requireApproval
                                      ? t("choresPage.approval.required")
                                      : t("choresPage.approval.no")}
                                  </td>
                                ) : null}
                                <td className="chores-col-actions">
                                  <div className="chores-row-actions">
                                    {viewerRole === "admin" && canApproveChore(chore) ? (
                                      <>
                                        <Button
                                          type="button"
                                          className="btn btn-primary chores-inline-approve"
                                          disabled={hasBusyAction}
                                          onClick={() => void onApproveChore(chore)}>
                                          {rowActionState?.choreId === chore.id &&
                                          rowActionState.action === "approve"
                                            ? t("choresPage.actions.approving")
                                            : t("choresPage.actions.approve")}
                                        </Button>
                                        <Button
                                          type="button"
                                          className="btn btn-secondary chores-inline-reject"
                                          disabled={hasBusyAction}
                                          onClick={() => {
                                            setRejectFeedback("");
                                            setPendingRejectChore(chore);
                                          }}>
                                          {t("choresPage.actions.reject")}
                                        </Button>
                                      </>
                                    ) : null}
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
                                      onApprove={onApproveChore}
                                      onRejectRequested={(selectedChore) => {
                                        setRejectFeedback("");
                                        setPendingRejectChore(selectedChore);
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  {canCreateChores ? (
                    <div className="chores-empty-cta chores-add-more-cta">
                      <AddEditChoresDialog
                        createMode={playerSeeAndDoMode ? "see_and_do" : "default"}
                        triggerLabel={playerSeeAndDoMode ? t("choresPage.actions.addSeeAndDo") : t("choresPage.actions.addMoreChores")}
                        onSaved={() => loadChores({ silent: true })}
                      />
                    </div>
                  ) : null}
                  <div className="table-pager chores-pager">
                    <div className="chores-pager-size">
                      <span className="small">{t("choresPage.pager.rowsPerPage")}</span>
                      <TailwindSelect
                        ariaLabel={t("choresPage.pager.rowsPerPage")}
                        value={String(pageSize)}
                        onChange={(value) => {
                          setPageSize(Number(value));
                          setPage(1);
                        }}
                        options={PAGE_SIZE_OPTIONS.map((size) => ({
                          value: String(size),
                          label: String(size),
                        }))}
                      />
                    </div>
                    <div className="chores-pager-nav">
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}>
                        {t("choresPage.pager.previous")}
                      </Button>
                      <span className="small">
                        {t("choresPage.pager.pageOf", { page, totalPages })}
                      </span>
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={page >= totalPages}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                        {t("choresPage.pager.next")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : null}
      </main>
      <ModalShell
        open={Boolean(pendingApproveChore)}
        onRequestClose={() => setPendingApproveChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingApproveChore ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">{t("choresPage.modals.approveTitle")}</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingApproveChore(null)}
                  aria-label={t("choresPage.modals.close")}
                  title={t("choresPage.modals.close")}>
                  X
                </Button>
              </div>
              <p className="mb-3 text-sm text-slate-600">
                {t("choresPage.modals.approveSummary", {
                  title: pendingApproveChore.title,
                  coins: pendingApproveChore.coinValue,
                })}
              </p>
              <div className="mb-4 flex flex-col gap-2">
                {(
                  pendingApproveChore.assigneeIds && pendingApproveChore.assigneeIds.length > 0
                    ? pendingApproveChore.assigneeIds
                    : pendingApproveChore.assigneeId
                      ? [pendingApproveChore.assigneeId]
                      : []
                ).map((assigneeId) => (
                  <label key={assigneeId} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <FamilyMemberAvatar
                        size={28}
                        borderWidth={1}
                        name={assigneeDirectoryByAlias[assigneeId]?.name || t("choresPage.familyMemberFallback")}
                        avatarId={assigneeDirectoryByAlias[assigneeId]?.avatarId}
                        avatarPhotoUrl={assigneeDirectoryByAlias[assigneeId]?.avatarPhotoUrl}
                        isFamily={pendingApproveChore.assigneeScope === "family" && !assigneeDirectoryByAlias[assigneeId]}
                        ariaHidden
                      />
                      <span>{assigneeDirectoryByAlias[assigneeId]?.name || assigneeId}</span>
                    </span>
                    <span className="relative inline-flex items-center">
                      <span className="pointer-events-none absolute left-2 inline-flex items-center text-amber-500">
                        <CoinIcon size={14} />
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={approvalCoinsByAssignee[assigneeId] ?? 0}
                        onChange={(event) =>
                          setApprovalCoinsByAssignee((current) => ({
                            ...current,
                            [assigneeId]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                          }))
                        }
                        className="h-9 w-24 rounded-md border border-slate-300 pl-7 pr-2 py-1 text-right text-slate-800"
                      />
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={hasBusyAction}
                  onClick={() => setPendingApproveChore(null)}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={hasBusyAction}
                  onClick={() => void onApproveWithOverrides()}>
                  {rowActionState?.choreId === pendingApproveChore.id && rowActionState.action === "approve"
                    ? t("choresPage.actions.approving")
                    : t("choresPage.actions.approve")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
      <ModalShell
        open={Boolean(pendingRejectChore)}
        onRequestClose={() => setPendingRejectChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingRejectChore ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">{t("choresPage.modals.rejectTitle")}</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingRejectChore(null)}
                  aria-label={t("choresPage.modals.close")}
                  title={t("choresPage.modals.close")}>
                  X
                </Button>
              </div>
              <p className="mb-3 text-sm text-slate-600">
                {t("choresPage.modals.rejectPrompt", { title: pendingRejectChore.title })}
              </p>
              <label className="mb-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("choresPage.modals.feedback")}</span>
                <textarea
                  rows={4}
                  value={rejectFeedback}
                  onChange={(event) => setRejectFeedback(event.target.value)}
                  placeholder={t("choresPage.modals.feedbackPlaceholder")}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  disabled={hasBusyAction}
                  onClick={() => setPendingRejectChore(null)}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
                  disabled={hasBusyAction}
                  onClick={async () => {
                    const rejected = await onRejectChore(pendingRejectChore.id, rejectFeedback);
                    if (rejected) {
                      setPendingRejectChore(null);
                      setRejectFeedback("");
                    }
                  }}>
                  {rowActionState?.choreId === pendingRejectChore.id &&
                  rowActionState.action === "reject"
                    ? t("choresPage.actions.rejecting")
                    : t("choresPage.actions.reject")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
      <ModalShell
        open={Boolean(pendingDeleteChore)}
        onRequestClose={() => setPendingDeleteChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingDeleteChore ? (
            <>
              <div className="modal-dialog-title-row mb-2">
                <h3 className="text-lg font-bold text-slate-800">{t("choresPage.modals.deleteTitle")}</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingDeleteChore(null)}
                  aria-label={t("choresPage.modals.close")}
                  title={t("choresPage.modals.close")}>
                  X
                </Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                {t("choresPage.modals.deletePrompt", { title: pendingDeleteChore.title })}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  disabled={hasBusyAction}
                  onClick={() => setPendingDeleteChore(null)}>
                  {t("common.actions.cancel")}
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
                    ? t("choresPage.actions.deleting")
                    : t("common.actions.delete")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
      <ModalShell
        open={pendingBulkSetCategoriesOpen}
        onRequestClose={() => setPendingBulkSetCategoriesOpen(false)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="modal-dialog-title-row mb-2">
            <h3 className="text-lg font-bold text-slate-800">{t("choresPage.modals.setCategoriesTitle")}</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setPendingBulkSetCategoriesOpen(false)}
              aria-label={t("choresPage.modals.close")}
              title={t("choresPage.modals.close")}>
              X
            </Button>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            {t("choresPage.modals.setCategoriesPrompt", {
              count: selectedCount,
              suffix: selectedCount === 1 ? "" : "s",
            })}
          </p>
          <TailwindMultiSelect
            ariaLabel={t("choresPage.modals.bulkCategories")}
            values={bulkCategoryIds}
            onChange={setBulkCategoryIds}
            options={categorySelectOptions}
            placeholder={categorySelectOptions.length > 0 ? t("choresPage.modals.selectCategories") : t("choresPage.modals.noCategoriesYet")}
            buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            menuClassName="border-slate-300"
          />
          {categorySelectOptions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              {t("choresPage.modals.noCategoriesBody")}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              disabled={hasBusyAction}
              onClick={() => setPendingBulkSetCategoriesOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
              disabled={hasBusyAction || selectedCount === 0}
              onClick={async () => {
                await onBulkSetCategories(Object.keys(selectedChoreStateById), bulkCategoryIds);
                setPendingBulkSetCategoriesOpen(false);
              }}>
              {bulkActionState?.action === "set_categories" ? t("choresPage.actions.applying") : t("choresPage.actions.apply")}
            </Button>
          </div>
        </div>
      </ModalShell>
      <ModalShell
        open={pendingBulkDeleteOpen}
        onRequestClose={() => setPendingBulkDeleteOpen(false)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="modal-dialog-title-row mb-2">
            <h3 className="text-lg font-bold text-slate-800">{t("choresPage.modals.deleteSelectedTitle")}</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setPendingBulkDeleteOpen(false)}
              aria-label={t("choresPage.modals.close")}
              title={t("choresPage.modals.close")}>
              X
            </Button>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            {t("choresPage.modals.deleteSelectedPrompt", {
              count: selectedCount,
              suffix: selectedCount === 1 ? "" : "s",
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              disabled={hasBusyAction}
              onClick={() => setPendingBulkDeleteOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              type="button"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
              disabled={hasBusyAction}
              onClick={async () => {
                await onBulkAction("delete", Object.keys(selectedChoreStateById));
                setPendingBulkDeleteOpen(false);
              }}>
              {bulkActionState?.action === "delete" ? t("choresPage.actions.deleting") : t("common.actions.delete")}
            </Button>
          </div>
        </div>
      </ModalShell>
    </>
  );
}





