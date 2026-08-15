"use client";

import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import {
  CustomRecurrenceDialog,
  customRecurrenceSummary,
} from "@/components/custom-recurrence-dialog";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  DEFAULT_CHORE_COIN_VALUE,
  MAX_CHORE_COIN_VALUE,
  type ChoreRecurrenceWeekday,
  type ChoreRecurrenceType,
  type ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";
import type { ChoreType } from "@/lib/chores/types";
import type { FamilyCategory } from "@/lib/family/types";
import {
  readFamilySummaryCache,
  writeFamilySummaryCache,
} from "@/lib/family/summary-cache";
import { responsibilityPillarSelectOptions } from "@/lib/responsibility/labels";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";
import { visibleChoreCategories } from "@packages/core";

type Suggestion = {
  description: string;
  familyCount: number;
  // Pillar the family last used for a chore with this title, so picking a
  // suggestion keeps the chore's established pillar instead of starting blank.
  responsibilityPillar?: ResponsibilityPillar;
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
  newSkillEnabled?: boolean;
  recurrenceType?: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  recurrenceDays?: ChoreRecurrenceWeekday[];
  responsibilityPillar?: ResponsibilityPillar;
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
    newSkillEnabled: boolean;
    recurrenceType: ChoreRecurrenceType;
    recurrenceInterval?: number;
    recurrenceUnit?: ChoreRecurrenceUnit;
    recurrenceDays?: ChoreRecurrenceWeekday[];
    responsibilityPillar?: ResponsibilityPillar;
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
const LAST_COIN_VALUE_STORAGE_KEY = "chores_last_coin_value";
const LAST_CATEGORY_IDS_STORAGE_KEY = "chores_last_category_ids";

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function readLastCoinValueFromStorage() {
  try {
    return window.localStorage.getItem(LAST_COIN_VALUE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastCoinValueToStorage(value: string) {
  try {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(LAST_COIN_VALUE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_COIN_VALUE_STORAGE_KEY, trimmed);
  } catch {
    // Ignore storage errors.
  }
}

function readLastCategoryIdsFromStorage() {
  try {
    const raw = window.localStorage.getItem(LAST_CATEGORY_IDS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeLastCategoryIdsToStorage(value: string[]) {
  try {
    const next = value.filter(Boolean);
    if (next.length === 0) {
      window.localStorage.removeItem(LAST_CATEGORY_IDS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_CATEGORY_IDS_STORAGE_KEY, JSON.stringify(next));
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
  const [newSkillEnabled, setNewSkillEnabled] = useState(false);
  const [responsibilityPillar, setResponsibilityPillar] = useState<ResponsibilityPillar | "">("");
  const [recurrenceType, setRecurrenceType] = useState<ChoreRecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceUnit, setRecurrenceUnit] = useState<ChoreRecurrenceUnit>("day");
  const [recurrenceDays, setRecurrenceDays] = useState<ChoreRecurrenceWeekday[]>([]);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);
  const [previousRecurrence, setPreviousRecurrence] = useState<{
    type: ChoreRecurrenceType;
    interval: string;
    unit: ChoreRecurrenceUnit;
    days: ChoreRecurrenceWeekday[];
  } | null>(null);
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
  const [membersLoading, setMembersLoading] = useState(false);
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
  const pillarSelectOptions = useMemo<TailwindSelectOption<ResponsibilityPillar | "">[]>(
    () => responsibilityPillarSelectOptions(t),
    [t],
  );

  function setDialogOpen(next: boolean) {
    if (controlledOpen === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  }

  function selectRecurrenceType(value: ChoreRecurrenceType) {
    if (value === "custom") {
      setPreviousRecurrence({
        type: recurrenceType,
        interval: recurrenceInterval,
        unit: recurrenceUnit,
        days: recurrenceDays,
      });
      setRecurrenceType("custom");
      if (recurrenceType !== "custom") {
        setRecurrenceInterval("1");
        setRecurrenceUnit("week");
        setRecurrenceDays([]);
      }
      setCustomRecurrenceOpen(true);
      return;
    }
    setRecurrenceType(value);
  }

  function cancelCustomRecurrence() {
    if (previousRecurrence && previousRecurrence.type !== "custom") {
      setRecurrenceType(previousRecurrence.type);
      setRecurrenceInterval(previousRecurrence.interval);
      setRecurrenceUnit(previousRecurrence.unit);
      setRecurrenceDays(previousRecurrence.days);
    }
    setPreviousRecurrence(null);
    setCustomRecurrenceOpen(false);
  }

  function saveCustomRecurrence(next: {
    interval: string;
    unit: ChoreRecurrenceUnit;
    days: ChoreRecurrenceWeekday[];
  }) {
    setRecurrenceType("custom");
    setRecurrenceInterval(next.interval);
    setRecurrenceUnit(next.unit);
    setRecurrenceDays(next.days);
    setPreviousRecurrence(null);
    setCustomRecurrenceOpen(false);
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
  // Categories are filtered by who the chore is assigned to: whole-family
  // categories are always available, member-specific categories appear only
  // when that member is among the assignees. Categories already selected on the
  // chore stay visible so an existing selection is never silently dropped.
  const visibleCategories = useMemo(
    () =>
      visibleChoreCategories({
        categories,
        familyMemberIds: members.map((member) => member.id),
        selectedAssigneeIds: assigneeIds.filter((id) => id !== FAMILY_ASSIGNEE_OPTION_ID),
        selectedCategoryIds: categoryIds,
      }),
    [categories, members, assigneeIds, categoryIds],
  );
  const categorySelectOptions = useMemo<TailwindSelectOption[]>(
    () =>
      visibleCategories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    [visibleCategories],
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
    const storedCategoryIds = readLastCategoryIdsFromStorage().filter((categoryId) =>
      allCategories.some((category) => category.id === categoryId),
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
    setCategoryIds((current) => (current.length > 0 ? current : storedCategoryIds));
    setAssigneeHydrated(true);
  }

  async function loadMembers() {
    // --- Instant path: apply cached data synchronously so the dialog renders
    //     with assignee options already populated before the network response.
    //     The cache is shared app-wide, so a dashboard visit has usually
    //     already warmed it and this path covers the common case. ---
    const cached = readFamilySummaryCache();
    if (cached) {
      applyMemberPayload(cached.members, cached.categories, cached.viewerUid);
    } else {
      // Only a genuinely cold open shows the loading state — a warm cache must
      // never flash a skeleton over options we can already render.
      setMembersLoading(true);
    }

    // --- Background revalidation: always fetch fresh data. ---
    try {
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
      writeFamilySummaryCache({
        members: allMembers,
        categories: allCategories,
        viewerUid,
      });
      applyMemberPayload(allMembers, allCategories, viewerUid);
    } finally {
      setMembersLoading(false);
    }
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
    setCategoryIds(chore?.categoryIds ?? readLastCategoryIdsFromStorage());
    setCoinValue(
      chore?.coinValue !== undefined
        ? String(chore.coinValue)
        : readLastCoinValueFromStorage() || String(DEFAULT_CHORE_COIN_VALUE),
    );
    setRequireApproval(Boolean(chore?.requireApproval));
    setNewSkillEnabled(chore ? chore.newSkillEnabled ?? true : false);
    setResponsibilityPillar(chore?.responsibilityPillar ?? "");
    setRecurrenceType(chore?.recurrenceType ?? "none");
    setRecurrenceInterval(String(chore?.recurrenceInterval ?? 1));
    setRecurrenceUnit(chore?.recurrenceUnit ?? "day");
    setRecurrenceDays(chore?.recurrenceDays ?? []);
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

  useEffect(() => {
    if (!open || isEditMode || isSeeAndDoMode) {
      return;
    }
    writeLastCoinValueToStorage(coinValue);
  }, [coinValue, isEditMode, isSeeAndDoMode, open]);

  useEffect(() => {
    if (!open || isEditMode || isSeeAndDoMode) {
      return;
    }
    writeLastCategoryIdsToStorage(categoryIds);
  }, [categoryIds, isEditMode, isSeeAndDoMode, open]);

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
    const resolvedNewSkillEnabled = isSeeAndDoMode
      ? false
      : showAdditionalOptions
        ? newSkillEnabled
        : isEditMode
          ? chore?.newSkillEnabled ?? true
          : false;
    const resolvedRecurrenceType = isSeeAndDoMode
      ? "none"
      : showAdditionalOptions
      ? recurrenceType
      : isEditMode
        ? chore?.recurrenceType ?? "none"
        : "none";
    // The pillar state is hydrated from the chore being edited and can also be
    // pre-filled from a picked suggestion, so it is always the source of truth —
    // collapsing Additional Options must never drop or wipe it.
    const resolvedResponsibilityPillar = isSeeAndDoMode ? "" : responsibilityPillar;
    const resolvedRecurrenceInterval =
      resolvedRecurrenceType === "custom"
        ? showAdditionalOptions
          ? Math.trunc(parsedRecurrenceInterval)
          : chore?.recurrenceInterval ?? 1
        : undefined;
    const resolvedRecurrenceUnit =
      resolvedRecurrenceType === "custom"
        ? showAdditionalOptions
          ? recurrenceUnit
          : chore?.recurrenceUnit ?? "day"
        : undefined;
    const resolvedRecurrenceDays =
      resolvedRecurrenceType === "custom" && resolvedRecurrenceUnit === "week"
        ? showAdditionalOptions
          ? recurrenceDays
          : chore?.recurrenceDays ?? []
        : [];
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
      setNewSkillEnabled(false);
      setResponsibilityPillar("");
      setRecurrenceType("none");
      setRecurrenceInterval("1");
      setRecurrenceUnit("day");
      setRecurrenceDays([]);
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
            newSkillEnabled: resolvedNewSkillEnabled,
            recurrenceType: resolvedRecurrenceType,
            recurrenceInterval: resolvedRecurrenceInterval,
            recurrenceUnit: resolvedRecurrenceUnit,
            recurrenceDays: resolvedRecurrenceDays,
            responsibilityPillar: resolvedResponsibilityPillar || undefined,
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
                  newSkillEnabled: resolvedNewSkillEnabled,
                  recurrenceType: resolvedRecurrenceType,
                  recurrenceInterval: resolvedRecurrenceInterval,
                  recurrenceUnit: resolvedRecurrenceUnit,
                  recurrenceDays: resolvedRecurrenceDays,
                  responsibilityPillar: resolvedResponsibilityPillar,
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
                  newSkillEnabled: resolvedNewSkillEnabled,
                  recurrenceType: resolvedRecurrenceType,
                  recurrenceInterval: resolvedRecurrenceInterval,
                  recurrenceUnit: resolvedRecurrenceUnit,
                  recurrenceDays: resolvedRecurrenceDays,
                  responsibilityPillar: resolvedResponsibilityPillar,
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
        setNewSkillEnabled(false);
        setRecurrenceType("none");
        setRecurrenceInterval("1");
        setRecurrenceUnit("day");
        setRecurrenceDays([]);
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

  function applySuggestion(suggestion: Suggestion) {
    setDescription(suggestion.description);
    // Only fill an empty pillar — an explicit choice made in this dialog wins.
    if (suggestion.responsibilityPillar) {
      setResponsibilityPillar((current) => current || suggestion.responsibilityPillar || "");
    }
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
        applySuggestion(selected);
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
        : error === "routine_step_single_assignee_only"
          ? "Routine steps can only be assigned to one person. Pick a single assignee — changing it moves the whole routine to that person."
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
                    applySuggestion(suggestion);
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
              <div className="grid gap-3 md:grid-cols-2">
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("choreDialog.assigneeLabel")}</span>
                {membersLoading && assigneeOptions.length === 0 ? (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-label={t("common.status.loadingFamilyMembers")}
                    className="h-10 w-full animate-pulse rounded-md border border-slate-200 bg-slate-100"
                  />
                ) : (
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
                )}
                {hasGoogleTaskAssigneeChangeWarning ? (
                  <Alert tone="warning">
                    {t("choreDialog.googleTasksWarning", { name: previousGoogleTasksOwnerName })}
                  </Alert>
                ) : null}
              </label>
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
              </div>
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
                  <div className="grid gap-3 md:grid-cols-2">
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

                    <div className="flex w-full flex-col gap-1.5">
                      <label className="flex w-full flex-col gap-1.5">
                        <span className="text-sm font-medium text-slate-700">{t("choreDialog.recurrenceLabel")}</span>
                        <TailwindSelect
                          ariaLabel={t("choreDialog.recurrenceLabel")}
                          value={recurrenceType}
                          onChange={(value) => selectRecurrenceType(value as ChoreRecurrenceType)}
                          options={recurrenceOptions}
                          className="w-full"
                          buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                          menuClassName="border-slate-300"
                          disabled={!showAdditionalOptions}
                        />
                      </label>
                      {recurrenceType === "custom" ? (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium text-slate-700">
                            {customRecurrenceSummary(recurrenceInterval, recurrenceUnit, recurrenceDays, t)}
                          </span>
                          <Button
                            type="button"
                            className="btn btn-secondary self-start"
                            disabled={!showAdditionalOptions}
                            onClick={() => {
                              setPreviousRecurrence({
                                type: recurrenceType,
                                interval: recurrenceInterval,
                                unit: recurrenceUnit,
                                days: recurrenceDays,
                              });
                              setCustomRecurrenceOpen(true);
                            }}>
                            {t("chores.recurrence.editCustom")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex w-full flex-col gap-1.5">
                      <span className="text-sm font-medium text-slate-700">{t("responsibility.choreDialog.label")}</span>
                      <TailwindSelect
                        ariaLabel={t("responsibility.choreDialog.label")}
                        value={responsibilityPillar}
                        onChange={(value) => setResponsibilityPillar(value as ResponsibilityPillar | "")}
                        options={pillarSelectOptions}
                        className="w-full"
                        buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                        menuClassName="border-slate-300"
                        disabled={!showAdditionalOptions}
                      />
                      <span className="text-xs text-slate-500">{t("responsibility.choreDialog.hint")}</span>
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
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
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

                    <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={newSkillEnabled}
                        disabled={!showAdditionalOptions}
                        onChange={(event) => setNewSkillEnabled(event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1f69b7]"
                      />
                      <span className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-slate-700">
                          {t("choreDialog.newSkillLabel")}
                        </span>
                        <span className="text-xs text-slate-500">
                          {t("choreDialog.newSkillHint")}
                        </span>
                      </span>
                    </label>
                  </div>
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
      <CustomRecurrenceDialog
        open={customRecurrenceOpen}
        interval={recurrenceInterval}
        unit={recurrenceUnit}
        days={recurrenceDays}
        anchorDate={dueDate}
        onCancel={cancelCustomRecurrence}
        onSave={saveCustomRecurrence}
      />
      {descriptionSuggestionMenuNode}
    </>
  );
}
