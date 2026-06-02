"use client";

import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  DEFAULT_CHORE_COIN_VALUE,
  DEFAULT_RECURRENCE_INTERVAL,
  MAX_CHORE_COIN_VALUE,
  type ChoreRecurrenceType,
  type ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";
import type { ChoreType } from "@/lib/chores/types";
import type { FamilyCategory } from "@/lib/family/types";

type Suggestion = {
  description: string;
  familyCount: number;
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
  choreType?: ChoreType;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName?: string;
  source?: "manual" | "google_tasks";
  dueDate?: string;
  details?: string;
  categoryIds?: string[];
  coinValue?: number;
  requireApproval?: boolean;
  recurrenceType?: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
};

export type AddEditChoreSavedResult = {
  mode: "create" | "edit";
  phase: "pending" | "success" | "error";
  choreIds: string[];
  requestId?: string;
  pendingChore?: {
    id: string;
    title: string;
    choreType?: ChoreType;
    assigneeId?: string;
    assigneeIds?: string[];
    assigneeScope?: "single" | "multiple" | "family";
    assigneeName: string;
    dueDate: string;
    details?: string;
    categoryIds?: string[];
    categories?: FamilyCategory[];
    coinValue: number;
    requireApproval: boolean;
    recurrenceType: ChoreRecurrenceType;
    recurrenceInterval?: number;
    recurrenceUnit?: ChoreRecurrenceUnit;
  };
  error?: string;
};

type AddEditChoresDialogProps = {
  onSaved?: (result: AddEditChoreSavedResult) => Promise<void> | void;
  triggerLabel?: string;
  triggerClassName?: string;
  chore?: EditableChore;
  defaultAssigneeIds?: string[];
  renderTrigger?: (openDialog: () => void) => ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  optimisticCreate?: boolean;
  createMode?: "default" | "see_and_do";
};

const LAST_ASSIGNEE_STORAGE_KEY = "chores_last_assignee_id";
export const FAMILY_ASSIGNEE_OPTION_ID = "__family__";
const ADDITIONAL_OPTIONS_STORAGE_KEY = "chores_additional_options_open_v2";

// ---------------------------------------------------------------------------
// Module-level family-summary cache (stale-while-revalidate).
// Shared across all dialog instances so the second open is always instant.
// ---------------------------------------------------------------------------
type FamilySummaryCache = {
  members: FamilyMemberOption[];
  categories: FamilyCategory[];
  viewerUid: string;
  cachedAt: number;
};

const FAMILY_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
let familySummaryCache: FamilySummaryCache | null = null;

function readFamilySummaryCache(): FamilySummaryCache | null {
  if (!familySummaryCache) return null;
  if (Date.now() - familySummaryCache.cachedAt > FAMILY_SUMMARY_CACHE_TTL_MS) {
    familySummaryCache = null;
    return null;
  }
  return familySummaryCache;
}

function writeFamilySummaryCache(
  members: FamilyMemberOption[],
  categories: FamilyCategory[],
  viewerUid: string,
) {
  familySummaryCache = { members, categories, viewerUid, cachedAt: Date.now() };
}

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

function readAdditionalOptionsPreferenceFromStorage() {
  try {
    return window.localStorage.getItem(ADDITIONAL_OPTIONS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAdditionalOptionsPreferenceToStorage(value: boolean) {
  try {
    window.localStorage.setItem(ADDITIONAL_OPTIONS_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Ignore storage errors.
  }
}
export function AddEditChoresDialog({
  onSaved,
  triggerLabel = "Let's add some!",
  triggerClassName = "btn btn-primary",
  chore,
  defaultAssigneeIds,
  renderTrigger,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  optimisticCreate = false,
  createMode = "default",
}: AddEditChoresDialogProps) {
  const { t } = useLocale();
  const SUGGESTION_GAP_PX = 6;
  const SUGGESTION_VIEWPORT_MARGIN_PX = 8;
  const SUGGESTION_MIN_HEIGHT_PX = 120;
  const SUGGESTION_MAX_HEIGHT_PX = 224;

  const isEditMode = Boolean(chore);
  const isSeeAndDoMode = !isEditMode && createMode === "see_and_do";
  const editingChoreId = chore?.id ?? "";
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [details, setDetails] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [coinValue, setCoinValue] = useState(String(DEFAULT_CHORE_COIN_VALUE));
  const [requireApproval, setRequireApproval] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<ChoreRecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState(
    String(DEFAULT_RECURRENCE_INTERVAL),
  );
  const [recurrenceUnit, setRecurrenceUnit] = useState<ChoreRecurrenceUnit>("day");
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [maxActiveChores, setMaxActiveChores] = useState<number | null>(null);
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
  const [categories, setCategories] = useState<FamilyCategory[]>([]);
  const [assigneeHydrated, setAssigneeHydrated] = useState(false);
  const effectiveDueDate = showAdditionalOptions ? dueDate : todayIsoDate();
  const recurrenceOptions: TailwindSelectOption<ChoreRecurrenceType>[] = useMemo(
    () => [
      { value: "none", label: t("choreDialog.recurrence.none") },
      { value: "instant", label: t("choreDialog.recurrence.instant") },
      { value: "daily", label: t("choreDialog.recurrence.daily") },
      { value: "weekly", label: t("choreDialog.recurrence.weekly") },
      { value: "monthly", label: t("choreDialog.recurrence.monthly") },
      { value: "custom", label: t("choreDialog.recurrence.custom") },
    ],
    [t],
  );
  const customRecurrenceUnitOptions: TailwindSelectOption<ChoreRecurrenceUnit>[] = useMemo(
    () => [
      { value: "day", label: t("choreDialog.recurrence.days") },
      { value: "week", label: t("choreDialog.recurrence.weeks") },
      { value: "month", label: t("choreDialog.recurrence.months") },
    ],
    [t],
  );

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
    () => [{ value: FAMILY_ASSIGNEE_OPTION_ID, label: "Family" }, ...assigneeOptions],
    [assigneeOptions],
  );
  const isFamilyAssignee = assigneeIds.includes(FAMILY_ASSIGNEE_OPTION_ID);
  const hasMultipleAssignees = isFamilyAssignee || assigneeIds.length > 1;
  const categorySelectOptions = useMemo<TailwindSelectOption[]>(
    () =>
      categories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    [categories],
  );
  const hasGoogleTaskAssigneeChangeWarning =
    isEditMode &&
    chore?.source === "google_tasks" &&
    assigneeHydrated &&
    (assigneeIds.length !== 1 || assigneeIds[0] !== (chore?.assigneeId ?? ""));
  const previousGoogleTasksOwnerName =
    members.find((member) => member.id === (chore?.assigneeId ?? ""))?.name ||
    chore?.assigneeName ||
    "this user";
  const titleTypeSuffix = isSeeAndDoMode
    ? " (See and Do)"
    : hasMultipleAssignees || chore?.choreType === "group"
      ? " (Group)"
      : "";

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
    if (assigneeIds.length === 1 && assigneeIds[0] && assigneeIds[0] !== FAMILY_ASSIGNEE_OPTION_ID) {
      params.set("assigneeId", assigneeIds[0]);
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

  // Applies a resolved member payload to component state. Called both on a
  // cache hit (synchronously) and after a successful network response, so the
  // setAssigneeIds updater form ("current.length > 0 ? current : …") ensures a
  // second call never overwrites a selection the user has already made.
  function applyMemberPayload(
    allMembers: FamilyMemberOption[],
    allCategories: FamilyCategory[],
    viewerUid: string,
  ) {
    setMembers(allMembers);
    setCategories(allCategories);
    if (chore) {
      setAssigneeIds(
        chore.assigneeScope === "family"
          ? [FAMILY_ASSIGNEE_OPTION_ID]
          : chore.assigneeIds && chore.assigneeIds.length > 0
            ? chore.assigneeIds
            : chore.assigneeId
              ? [chore.assigneeId]
              : [],
      );
      setCategoryIds(chore.categoryIds ?? []);
      setAssigneeHydrated(true);
      return;
    }
    const preferredAssigneeIds =
      defaultAssigneeIds?.filter(
        (value) =>
          value === FAMILY_ASSIGNEE_OPTION_ID || allMembers.some((member) => member.id === value),
      ) ?? [];
    const stickyAssigneeId = readLastAssigneeId();
    const stickyIsFamily = stickyAssigneeId === FAMILY_ASSIGNEE_OPTION_ID;
    const stickyMember = stickyIsFamily
      ? null
      : allMembers.find((member) => member.id === stickyAssigneeId);
    const viewer = allMembers.find(
      (member) => member.id === viewerUid || member.uid === viewerUid,
    );
    setAssigneeIds((current) =>
      current.length > 0
        ? current
        : preferredAssigneeIds.length > 0
          ? preferredAssigneeIds
          : stickyIsFamily
            ? [FAMILY_ASSIGNEE_OPTION_ID]
            : stickyMember?.id
              ? [stickyMember.id]
              : viewer?.id
                ? [viewer.id]
                : [],
    );
    setAssigneeHydrated(true);
  }

  async function loadMembers() {
    // --- Instant path: apply cached data synchronously so the dialog renders
    //     with assignee options already populated before the network response. ---
    const cached = readFamilySummaryCache();
    if (cached) {
      applyMemberPayload(cached.members, cached.categories, cached.viewerUid);
    }

    // --- Background revalidation: always fetch fresh data. ---
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const response = await fetch(`/api/family/summary?tzOffsetMinutes=${tzOffsetMinutes}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      // If the cache already covered us, swallow the error silently.
      if (cached) return;
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? `FAMILY_HTTP_${response.status}`);
    }
    const payload = (await response.json()) as {
      members?: FamilyMemberOption[];
      categories?: FamilyCategory[];
      viewerUid?: string;
    };
    const allMembers = payload.members ?? [];
    const allCategories = payload.categories ?? [];
    const viewerUid = payload.viewerUid ?? "";
    writeFamilySummaryCache(allMembers, allCategories, viewerUid);
    applyMemberPayload(allMembers, allCategories, viewerUid);
  }

  // Reveal Additional Options from the locally stored preference, but only ever
  // open it — never collapse — so a new chore that starts hidden does not flash
  // open and then snap shut while the saved preference is resolving.
  function revealAdditionalOptionsFromStorage() {
    if (readAdditionalOptionsPreferenceFromStorage()) {
      setShowAdditionalOptions(true);
    }
  }

  async function loadAdditionalOptionsPreference() {
    try {
      const response = await fetch("/api/preferences", { cache: "no-store" });
      if (!response.ok) {
        revealAdditionalOptionsFromStorage();
        return;
      }
      const payload = (await response.json()) as {
        choreAdvancedOptionsOpenV2?: boolean;
      };
      if (typeof payload.choreAdvancedOptionsOpenV2 === "boolean") {
        setShowAdditionalOptions(payload.choreAdvancedOptionsOpenV2);
        writeAdditionalOptionsPreferenceToStorage(payload.choreAdvancedOptionsOpenV2);
      } else {
        revealAdditionalOptionsFromStorage();
      }
    } catch {
      revealAdditionalOptionsFromStorage();
    }
  }

  function persistAdditionalOptionsPreference(next: boolean) {
    setShowAdditionalOptions(next);
    writeAdditionalOptionsPreferenceToStorage(next);
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choreAdvancedOptionsOpenV2: next }),
    }).catch(() => {
      // Keep local value; retry will happen on next toggle.
    });
  }

  function hydrateFromChore(preferredOpen: boolean) {
    setDescription(chore?.title ?? "");
    setAssigneeIds(
      chore?.assigneeScope === "family"
        ? [FAMILY_ASSIGNEE_OPTION_ID]
        : chore?.assigneeIds && chore.assigneeIds.length > 0
          ? chore.assigneeIds
          : chore?.assigneeId
            ? [chore.assigneeId]
            : [],
    );
    setDueDate(chore?.dueDate || todayIsoDate());
    setDetails(chore?.details ?? "");
    setCategoryIds(chore?.categoryIds ?? []);
    setCoinValue(String(chore?.coinValue ?? DEFAULT_CHORE_COIN_VALUE));
    setRequireApproval(Boolean(chore?.requireApproval));
    setRecurrenceType(chore?.recurrenceType ?? "none");
    setRecurrenceInterval(String(chore?.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL));
    setRecurrenceUnit(chore?.recurrenceUnit ?? "day");
    setShowAdditionalOptions(preferredOpen);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setAssigneeHydrated(false);
    const localAdditionalOptionsPreference = readAdditionalOptionsPreferenceFromStorage();
    // New chores always start with Additional Options hidden, then the saved
    // preference (server, with local fallback) reveals it if it is set to open.
    // Edit mode keeps the stored preference so existing field values stay visible.
    hydrateFromChore(isEditMode ? localAdditionalOptionsPreference : false);
    void Promise.all([loadSuggestions(), loadMembers()]).catch((loadError) => {
      setError(normalizeError(loadError));
    });
    void loadAdditionalOptionsPreference();
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
  }, [description, assigneeIds, effectiveDueDate, open]);

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
    if (!open || !assigneeHydrated || isEditMode || assigneeIds.length !== 1) {
      return;
    }
    const onlyAssigneeId = assigneeIds[0] ?? "";
    if (!onlyAssigneeId) {
      return;
    }
    writeLastAssigneeId(onlyAssigneeId);
  }, [assigneeHydrated, assigneeIds, isEditMode, open]);

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

    const resolvedAssigneeIds = isSeeAndDoMode
      ? []
      : isFamilyAssignee
      ? []
      : assigneeIds.filter((id) => id && id !== FAMILY_ASSIGNEE_OPTION_ID);
    const singleAssigneeId = resolvedAssigneeIds.length === 1 ? resolvedAssigneeIds[0] : "";
    const resolvedAssigneeName = isFamilyAssignee
      ? "Family"
      : resolvedAssigneeIds.length > 1
        ? `${resolvedAssigneeIds.length} assignees`
        : members.find((member) => member.id === singleAssigneeId)?.name || "Unassigned";
    const fallbackDueDate = chore?.dueDate || todayIsoDate();
    const fallbackDetails = chore?.details ?? "";
    const fallbackCategoryIds = chore?.categoryIds ?? [];
    const resolvedDueDate = showAdditionalOptions
      ? dueDate
      : isEditMode
        ? fallbackDueDate
        : todayIsoDate();
    const resolvedDetails = showAdditionalOptions
      ? details
      : isEditMode
        ? fallbackDetails
        : "";
    const resolvedCategoryIds = showAdditionalOptions
      ? categoryIds
      : isEditMode
        ? fallbackCategoryIds
        : [];
    const parsedCoinValue = Number(coinValue);
    if (
      !Number.isFinite(parsedCoinValue) ||
      !Number.isInteger(parsedCoinValue) ||
      Math.trunc(parsedCoinValue) < 0 ||
      Math.trunc(parsedCoinValue) > MAX_CHORE_COIN_VALUE
    ) {
      setError(`coin_value_must_be_whole_number_0_to_${MAX_CHORE_COIN_VALUE}`);
      return;
    }
    const resolvedCoinValue = isSeeAndDoMode
      ? 0
      : Math.trunc(parsedCoinValue);
    const parsedRecurrenceInterval = Number(recurrenceInterval);
    if (
      showAdditionalOptions &&
      recurrenceType === "custom" &&
      (!Number.isFinite(parsedRecurrenceInterval) || Math.trunc(parsedRecurrenceInterval) < 1)
    ) {
      setError("custom_recurrence_interval_required");
      return;
    }
    const resolvedRequireApproval = isSeeAndDoMode
      ? true
      : hasMultipleAssignees
      ? true
      : showAdditionalOptions
      ? requireApproval
      : isEditMode
        ? Boolean(chore?.requireApproval)
        : false;
    const resolvedRecurrenceType = isSeeAndDoMode
      ? "none"
      : showAdditionalOptions
      ? recurrenceType
      : isEditMode
        ? chore?.recurrenceType ?? "none"
        : "none";
    const resolvedRecurrenceInterval =
      resolvedRecurrenceType === "custom"
        ? showAdditionalOptions
          ? Math.trunc(parsedRecurrenceInterval)
          : chore?.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL
        : undefined;
    const resolvedRecurrenceUnit =
      resolvedRecurrenceType === "custom"
        ? showAdditionalOptions
          ? recurrenceUnit
          : chore?.recurrenceUnit ?? "day"
        : undefined;
    const resolvedCategories = resolvedCategoryIds
      .map((categoryId) => categories.find((category) => category.id === categoryId))
      .filter((category): category is FamilyCategory => Boolean(category));
    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pending-${Date.now()}`;

    const useOptimisticCreate = !isEditMode && optimisticCreate;

    setSaving(true);
    setError("");
    setMaxActiveChores(null);

    if (useOptimisticCreate) {
      setDialogOpen(false);
      setDescription("");
      setShowSuggestionMenu(false);
      setActiveSuggestionIndex(-1);
      setAssigneeIds([]);
      setDueDate(todayIsoDate());
      setDetails("");
      setCategoryIds([]);
      setCoinValue(String(DEFAULT_CHORE_COIN_VALUE));
      setRequireApproval(false);
      setRecurrenceType("none");
      setRecurrenceInterval(String(DEFAULT_RECURRENCE_INTERVAL));
      setRecurrenceUnit("day");
      setShowAdditionalOptions(false);
      if (onSaved) {
        await onSaved({
          mode: "create",
          phase: "pending",
          choreIds: [],
          requestId,
            pendingChore: {
              id: requestId,
              title: normalizedDescription,
              choreType: isSeeAndDoMode ? "see_and_do" : hasMultipleAssignees ? "group" : "normal",
                  assigneeId: singleAssigneeId || undefined,
                  assigneeIds: isFamilyAssignee
                    ? []
                    : resolvedAssigneeIds,
                  assigneeScope: isFamilyAssignee
                    ? "family"
                    : resolvedAssigneeIds.length > 1
                      ? "multiple"
                      : "single",
                  assigneeName: resolvedAssigneeName,
            dueDate: resolvedDueDate,
            details: resolvedDetails,
            categoryIds: resolvedCategoryIds,
            categories: resolvedCategories,
            coinValue: resolvedCoinValue,
            requireApproval: resolvedRequireApproval,
            recurrenceType: resolvedRecurrenceType,
            recurrenceInterval: resolvedRecurrenceInterval,
            recurrenceUnit: resolvedRecurrenceUnit,
          },
        });
      }
    }

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
                  assigneeId: singleAssigneeId,
                  assigneeIds: isFamilyAssignee ? [] : resolvedAssigneeIds,
                  assigneeScope: isFamilyAssignee
                    ? "family"
                    : resolvedAssigneeIds.length > 1
                      ? "multiple"
                      : "single",
                  dueDate: resolvedDueDate,
                  details: resolvedDetails,
                  categoryIds: resolvedCategoryIds,
                  coinValue: resolvedCoinValue,
                  requireApproval: resolvedRequireApproval,
                  recurrenceType: resolvedRecurrenceType,
                  recurrenceInterval: resolvedRecurrenceInterval,
                  recurrenceUnit: resolvedRecurrenceUnit,
                  choreType: isSeeAndDoMode ? "see_and_do" : hasMultipleAssignees ? "group" : "normal",
                }
              : {
                  description: normalizedDescription,
                  choreType: isSeeAndDoMode ? "see_and_do" : hasMultipleAssignees ? "group" : "normal",
                  assigneeId: singleAssigneeId,
                  assigneeIds: isFamilyAssignee ? [] : resolvedAssigneeIds,
                  assigneeScope: isFamilyAssignee
                    ? "family"
                    : resolvedAssigneeIds.length > 1
                      ? "multiple"
                      : "single",
                  dueDate: showAdditionalOptions ? dueDate : undefined,
                  details: resolvedDetails,
                  categoryIds: resolvedCategoryIds,
                  coinValue: resolvedCoinValue,
                  requireApproval: resolvedRequireApproval,
                  recurrenceType: resolvedRecurrenceType,
                  recurrenceInterval: resolvedRecurrenceInterval,
                  recurrenceUnit: resolvedRecurrenceUnit,
                },
          ),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        maxActiveChores?: number;
        createdChoreIds?: string[];
      };
      if (!response.ok) {
        setMaxActiveChores(
          typeof body.maxActiveChores === "number" ? body.maxActiveChores : null,
        );
        throw new Error(
          body.error ??
            (isEditMode
              ? `UPDATE_CHORE_HTTP_${response.status}`
              : `CREATE_CHORES_HTTP_${response.status}`),
        );
      }

      const savedResult: AddEditChoreSavedResult = {
        mode: isEditMode ? "edit" : "create",
        phase: "success",
        requestId,
        choreIds: isEditMode
          ? [editingChoreId]
          : Array.isArray(body.createdChoreIds)
            ? body.createdChoreIds.filter((id): id is string => typeof id === "string")
            : [],
      };

      if (isEditMode || !useOptimisticCreate) {
        setDialogOpen(false);
        setDescription("");
        setShowSuggestionMenu(false);
        setActiveSuggestionIndex(-1);
        setAssigneeIds([]);
        setDueDate(todayIsoDate());
        setDetails("");
        setCategoryIds([]);
        setCoinValue(String(DEFAULT_CHORE_COIN_VALUE));
        setRequireApproval(false);
        setRecurrenceType("none");
        setRecurrenceInterval(String(DEFAULT_RECURRENCE_INTERVAL));
        setRecurrenceUnit("day");
        setShowAdditionalOptions(false);
      }
      if (onSaved) {
        await onSaved(savedResult);
      }
    } catch (submitError) {
      const message = normalizeError(submitError);
      if (isEditMode || !useOptimisticCreate) {
        setError(message);
      }
      if (onSaved) {
        await onSaved({
          mode: isEditMode ? "edit" : "create",
          phase: "error",
          requestId,
          choreIds: isEditMode ? [editingChoreId] : [],
          error: message,
        });
      }
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

  const isActiveChoreLimitError = error === "active_chore_limit_reached";
  const isCoinValueError = error.startsWith("coin_value_must_be_whole_number_0_to_");
  const errorMessage = isActiveChoreLimitError
    ? `This assignee has reached the maximum number of open chores (${maxActiveChores ?? 100}). Complete or remove an open chore before adding another.`
    : isCoinValueError
      ? `Coin value must be a whole number between 0 and ${MAX_CHORE_COIN_VALUE}.`
      : error === "custom_recurrence_interval_required"
        ? "Custom recurrence needs an interval of at least 1."
    : error;

  const descriptionSuggestionMenuNode =
    open &&
    showSuggestionMenu &&
    filteredSuggestions.length > 0 &&
    suggestionMenuPosition &&
    typeof document !== "undefined"
      ? createPortal(
          <ul
            className="z-[160] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
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
            <div className="modal-dialog-title-row mb-3">
              <h3 className="text-lg font-bold text-slate-800">
                {isEditMode ? (
                  t("choreDialog.editTitle")
                ) : (
                  <>
                    {t("choreDialog.addTitle")}
                    {titleTypeSuffix ? <span className="font-medium text-slate-500">{titleTypeSuffix}</span> : null}
                  </>
                )}
              </h3>
              <Button
                type="button"
                className="modal-close-button"
                onClick={() => setDialogOpen(false)}
                aria-label={t("common.actions.close")}
                title={t("common.actions.close")}>
                X
              </Button>
            </div>
            <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("choreDialog.descriptionLabel")}</span>
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
                    placeholder={t("choreDialog.descriptionPlaceholder")}
                    className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                  />
                </div>
              </label>
              {isSeeAndDoMode ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {t("choreDialog.seeAndDoNotice")}
                </p>
              ) : null}

              {!isSeeAndDoMode ? (
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("choreDialog.assigneeLabel")}</span>
                <TailwindMultiSelect
                  ariaLabel={t("choreDialog.assigneeLabel")}
                  values={assigneeIds}
                  onChange={(nextValues) => {
                    const hadFamilySelected = assigneeIds.includes(FAMILY_ASSIGNEE_OPTION_ID);
                    const hasFamilySelected = nextValues.includes(FAMILY_ASSIGNEE_OPTION_ID);
                    if (!hadFamilySelected && hasFamilySelected) {
                      setAssigneeIds([FAMILY_ASSIGNEE_OPTION_ID]);
                      return;
                    }
                    if (hadFamilySelected && hasFamilySelected) {
                      setAssigneeIds(
                        nextValues.filter((value) => value !== FAMILY_ASSIGNEE_OPTION_ID),
                      );
                      return;
                    }
                    setAssigneeIds(nextValues);
                  }}
                  options={assigneeSelectOptions}
                  placeholder={t("choreDialog.assigneePlaceholder")}
                  className="w-full"
                  buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  menuClassName="border-slate-300"
                />
                {hasGoogleTaskAssigneeChangeWarning ? (
                  <Alert tone="warning">
                    {t("choreDialog.googleTasksWarning", { name: previousGoogleTasksOwnerName })}
                  </Alert>
                ) : null}
              </label>
              ) : null}

              {!isSeeAndDoMode ? (
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("choreDialog.coinValueLabel")}</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_CHORE_COIN_VALUE}
                  step={1}
                  value={coinValue}
                  onChange={(event) => setCoinValue(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
                />
              </label>
              ) : null}

              {!isSeeAndDoMode ? (
              <Button
                type="button"
                className="group inline-flex cursor-pointer items-center gap-2 self-start text-sm font-semibold text-[#1f69b7]"
                onClick={() => persistAdditionalOptionsPreference(!showAdditionalOptions)}>
                <span aria-hidden="true" className="text-base leading-none font-bold">
                  {showAdditionalOptions ? "-" : "+"}
                </span>
                <span className="group-hover:underline group-focus-visible:underline">
                  {t("choreDialog.additionalOptions")}
                </span>
              </Button>
              ) : null}

              {!isSeeAndDoMode ? (
              <div
                className={`add-chores-advanced${showAdditionalOptions ? " is-open" : ""}`}
                aria-hidden={!showAdditionalOptions}>
                <div className="add-chores-advanced-inner">
                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">{t("choreDialog.dueDateLabel")}</span>
                    <input
                      type="date"
                      value={dueDate}
                      disabled={!showAdditionalOptions}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                    <label className="flex w-full flex-col gap-1.5">
                      <span className="text-sm font-medium text-slate-700">{t("choreDialog.recurrenceLabel")}</span>
                      <TailwindSelect
                        ariaLabel={t("choreDialog.recurrenceLabel")}
                        value={recurrenceType}
                        onChange={(value) => setRecurrenceType(value as ChoreRecurrenceType)}
                        options={recurrenceOptions}
                        className="w-full"
                        buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                        menuClassName="border-slate-300"
                        disabled={!showAdditionalOptions}
                      />
                    </label>
                    {recurrenceType === "custom" ? (
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                        <label className="flex w-full flex-col gap-1.5">
                          <span className="text-sm font-medium text-slate-700">{t("choreDialog.everyLabel")}</span>
                          <input
                            type="number"
                            min={1}
                            max={365}
                            step={1}
                            value={recurrenceInterval}
                            disabled={!showAdditionalOptions}
                            onChange={(event) => setRecurrenceInterval(event.target.value)}
                            className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
                          />
                        </label>
                        <label className="flex w-full flex-col gap-1.5">
                          <span className="text-sm font-medium text-slate-700">{t("choreDialog.unitLabel")}</span>
                          <TailwindSelect
                            ariaLabel={t("choreDialog.unitLabel")}
                            value={recurrenceUnit}
                            onChange={(value) => setRecurrenceUnit(value as ChoreRecurrenceUnit)}
                            options={customRecurrenceUnitOptions}
                            className="w-full"
                            buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                            menuClassName="border-slate-300"
                            disabled={!showAdditionalOptions}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>

                  <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={hasMultipleAssignees ? true : requireApproval}
                      disabled={!showAdditionalOptions || hasMultipleAssignees}
                      onChange={(event) => setRequireApproval(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1f69b7]"
                    />
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-slate-700">{t("choreDialog.requireApprovalLabel")}</span>
                      <span className="text-xs text-slate-500">
                        {hasMultipleAssignees
                          ? t("choreDialog.requireApprovalMultiHint")
                          : t("choreDialog.requireApprovalHint")}
                      </span>
                    </span>
                  </label>

                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">{t("choreDialog.categoriesLabel")}</span>
                    <TailwindMultiSelect
                      ariaLabel={t("choreDialog.categoriesLabel")}
                      values={categoryIds}
                      onChange={setCategoryIds}
                      options={categorySelectOptions}
                      disabled={!showAdditionalOptions}
                      placeholder={
                        categorySelectOptions.length > 0 ? t("choreDialog.categoriesPlaceholder") : t("choreDialog.noCategories")
                      }
                      className="w-full"
                      buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                      menuClassName="border-slate-300"
                      emptyState={
                        <span className="inline-flex items-center gap-2">
                          <span>{t("choreDialog.noCategories")}</span>
                          <Link
                            href="/family"
                            className="font-semibold text-[#1f69b7] underline"
                            onClick={() => setDialogOpen(false)}>
                            {t("choreDialog.manageCategories")}
                          </Link>
                        </span>
                      }
                    />
                  </label>

                  <label className="flex w-full flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700">{t("choreDialog.detailsLabel")}</span>
                    <textarea
                      rows={4}
                      value={details}
                      disabled={!showAdditionalOptions}
                      onChange={(event) => setDetails(event.target.value)}
                      placeholder={t("choreDialog.detailsPlaceholder")}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                    />
                  </label>
                </div>
              </div>
              ) : null}

              {error ? (
                isActiveChoreLimitError ? (
                  <Alert tone="warning">{errorMessage}</Alert>
                ) : (
                  <Alert>{errorMessage}</Alert>
                )
              ) : null}

              <div className="mt-1 flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => setDialogOpen(false)}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}>
                  {saving
                    ? t("family.memberLanguageSaving")
                    : isEditMode
                      ? t("choreDialog.saveChanges")
                      : t("dashboard.addChore")}
                </Button>
              </div>
            </form>
        </div>
      </ModalShell>
      {descriptionSuggestionMenuNode}
    </>
  );
}
