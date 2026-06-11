"use client";

import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/button";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";
import Link from "next/link";
import { CSSProperties, useState } from "react";
import type { FamilySnapshotChore } from "@/lib/family/types";

type TodayChoreCardProps = {
  chore: FamilySnapshotChore;
  isAdminViewer: boolean;
  canManageActions: boolean;
  canComplete: boolean;
  canReorder?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /**
   * Localized explanation for why reordering is unavailable (active sort,
   * active filters, busy action). Surfaced as the disabled-button tooltip.
   */
  reorderDisabledReason?: string;
  isDragging?: boolean;
  isDragOver?: boolean;
  dropIndicatorPosition?: "before" | "after" | null;
  busyAction: "" | "delete" | "complete";
  disabled: boolean;
  isExiting?: boolean;
  isCreatePending?: boolean;
  onDelete: (choreId: string) => Promise<void> | void;
  onComplete: (
    choreId: string,
    source?: { clientX: number; clientY: number },
  ) => Promise<void> | void;
  onMoveUp?: (choreId: string) => Promise<void> | void;
  onMoveDown?: (choreId: string) => Promise<void> | void;
  onDragStart?: (choreId: string) => void;
  onDragOver?: (choreId: string, position: "before" | "after") => void;
  onDrop?: (choreId: string, position: "before" | "after") => void;
  onDragEnd?: () => void;
  onEdited: () => Promise<void> | void;
};

function getSafeHexColor(value: string | undefined) {
  if (!value) {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  return "";
}

function getDisplayedCoinValue(chore: Pick<FamilySnapshotChore, "choreType" | "status" | "coinValue">) {
  if (chore.choreType === "see_and_do") {
    return "-";
  }
  return String(chore.coinValue ?? 0);
}

function getCoinTooltip(chore: Pick<FamilySnapshotChore, "choreType">) {
  if (chore.choreType === "see_and_do") {
    return "See and Do chore types will have coins assigned during parent approval";
  }
  return undefined;
}

function isRecurringChore(
  chore: Pick<FamilySnapshotChore, "recurrenceType">,
) {
  return Boolean(chore.recurrenceType) && chore.recurrenceType !== "none";
}

function CalendarRecurrenceIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14" />
      <path d="M7 3v3M13 3v3" />
    </svg>
  );
}

export function TodayChoreCard({
  chore,
  isAdminViewer,
  canManageActions,
  canComplete,
  canReorder = false,
  canMoveUp = false,
  canMoveDown = false,
  reorderDisabledReason = "",
  isDragging = false,
  isDragOver = false,
  dropIndicatorPosition = null,
  busyAction,
  disabled,
  isExiting = false,
  isCreatePending = false,
  onDelete,
  onComplete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdited,
}: TodayChoreCardProps) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Recurrence indicator starts collapsed (calendar icon) and toggles to the
  // frequency label on click. Local component state means a list reload/refresh
  // naturally resets every row back to the icon, as required.
  const [showRecurrenceFrequency, setShowRecurrenceFrequency] = useState(false);
  const recurring = isRecurringChore(chore);
  const newSkillBonusAmount = chore.newSkillBonusAmount ?? 5;

  function recurrenceFrequencyLabel() {
    const type = chore.recurrenceType;
    if (type === "daily") {
      return t("dashboard.recurrenceDaily");
    }
    if (type === "weekly") {
      return t("dashboard.recurrenceWeekly");
    }
    if (type === "monthly") {
      return t("dashboard.recurrenceMonthly");
    }
    if (type === "instant") {
      return t("dashboard.recurrenceInstant");
    }
    if (type === "custom") {
      const interval = Math.max(1, chore.recurrenceInterval ?? 2);
      const unit = chore.recurrenceUnit ?? "day";
      if (interval === 1) {
        return unit === "day"
          ? t("dashboard.recurrenceDaily")
          : unit === "week"
            ? t("dashboard.recurrenceWeekly")
            : t("dashboard.recurrenceMonthly");
      }
      const unitLabel =
        unit === "day"
          ? t("dashboard.recurrenceUnitDays")
          : unit === "week"
            ? t("dashboard.recurrenceUnitWeeks")
            : t("dashboard.recurrenceUnitMonths");
      return t("dashboard.recurrenceEvery", { count: String(interval), unit: unitLabel });
    }
    return t("dashboard.recurrenceCustom");
  }

  const recurrenceToggleLabel = showRecurrenceFrequency
    ? t("dashboard.recurringHideFrequency")
    : t("dashboard.recurringShowFrequency");
  const moveUpDisabledTitle = !canReorder
    ? reorderDisabledReason || undefined
    : !canMoveUp
      ? t("dashboard.moveUpAtTop")
      : undefined;
  const moveDownDisabledTitle = !canReorder
    ? reorderDisabledReason || undefined
    : !canMoveDown
      ? t("dashboard.moveDownAtBottom")
      : undefined;
  const assigneePrimaryColor = getSafeHexColor(chore.assigneePrimaryColor);
  const assigneeAvatarId = chore.assigneeAvatarId?.trim() || "";
  const assigneeAvatarPhotoUrl = chore.assigneeAvatarPhotoUrl?.trim() || "";
  const isMultiOrFamilyAssignee =
    chore.assigneeScope === "family" || (chore.assigneeIds?.length ?? 0) > 1;
  const actionHref = chore.actionHref?.trim() || "";
  // Only honor internal app links (defense against seeded/edited external URLs).
  const hasInternalActionHref = actionHref.startsWith("/") && !actionHref.startsWith("//");
  const actionLabel = chore.actionLabel?.trim() || "Open";

  return (
    <li
      className={`today-chore-item${isExiting ? " today-chore-item-exiting" : ""}${
        canReorder ? " is-draggable" : ""
      }${isDragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}${
        dropIndicatorPosition === "before" ? " is-drop-before" : ""
      }${dropIndicatorPosition === "after" ? " is-drop-after" : ""}${
        isCreatePending ? " is-create-pending" : ""
      }`}
      draggable={canReorder && !disabled && !isExiting}
      onDragStart={(event) => {
        if (!canReorder || disabled || isExiting) {
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", chore.id);
        onDragStart?.(chore.id);
      }}
      onDragOver={(event) => {
        if (!canReorder || disabled || isExiting) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position: "before" | "after" = event.clientY < midY ? "before" : "after";
        onDragOver?.(chore.id, position);
      }}
      onDrop={(event) => {
        if (!canReorder || disabled || isExiting) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position: "before" | "after" = event.clientY < midY ? "before" : "after";
        onDrop?.(chore.id, position);
      }}
      onDragEnd={() => onDragEnd?.()}
      style={
        {
          "--today-chore-rail-color": assigneePrimaryColor || "#cbd5e1",
        } as CSSProperties
      }>
      {isCreatePending ? (
        <span className="today-chore-loading-highlight today-chore-loading-highlight-gold" aria-hidden="true" />
      ) : null}
      <AddEditChoresDialog
        chore={{
          id: chore.id,
          title: chore.title,
          assigneeId: chore.assigneeId,
          assigneeIds: chore.assigneeIds,
          assigneeScope: chore.assigneeScope,
          assigneeName: chore.assigneeName,
          source: chore.source,
          dueDate: chore.dueDate,
          details: chore.details,
          categoryIds: chore.categoryIds,
          coinValue: chore.coinValue,
          requireApproval: chore.requireApproval,
          recurrenceType: chore.recurrenceType,
          recurrenceInterval: chore.recurrenceInterval,
          recurrenceUnit: chore.recurrenceUnit,
        }}
        onSaved={onEdited}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        hideTrigger
      />
      <div className="flex min-w-0 flex-col gap-3 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <FamilyMemberAvatar
              className="today-chore-avatar text-sm font-semibold"
              size={32}
              borderWidth={1}
              name={chore.assigneeName}
              avatarId={assigneeAvatarId}
              avatarPhotoUrl={assigneeAvatarPhotoUrl}
              primaryColor={assigneePrimaryColor || undefined}
              isFamily={chore.assigneeScope === "family"}
            />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="today-chore-title-row flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="break-words">{chore.title}</strong>
                {hasInternalActionHref ? (
                  <Link
                    href={actionHref}
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
                    {actionLabel}
                    <span aria-hidden="true">&#8594;</span>
                  </Link>
                ) : null}
              </span>
              <span className="block break-words">{chore.assigneeName}</span>
              {chore.newSkillBonusEligible ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700"
                  title={t("dashboard.newSkillBonusTooltip", {
                    amount: String(newSkillBonusAmount),
                  })}>
                  <span aria-hidden="true">&#10024;</span>
                  {t("dashboard.newSkillBadge", { amount: String(newSkillBonusAmount) })}
                  <CoinIcon size={14} />
                </span>
              ) : null}
              {(chore.categories?.length ?? 0) > 0 ? (
                <ChoreCategoriesChip categories={chore.categories} className="today-chore-categories-chip" />
              ) : null}
            </div>
          </div>
          <div className="today-chore-meta-actions">
            <div className="flex items-center gap-2">
              {canReorder ? (
                <span className="today-chore-drag-handle" aria-hidden="true" title="Drag to reorder">
                  &#8942;&#8942;
                </span>
              ) : null}
              {recurring ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  aria-label={recurrenceToggleLabel}
                  aria-pressed={showRecurrenceFrequency}
                  title={recurrenceToggleLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowRecurrenceFrequency((value) => !value);
                  }}>
                  {showRecurrenceFrequency ? (
                    <span>{recurrenceFrequencyLabel()}</span>
                  ) : (
                    <CalendarRecurrenceIcon />
                  )}
                </button>
              ) : null}
              <span
                className="inline-flex items-center gap-1 text-lg font-bold leading-none text-amber-600"
                title={getCoinTooltip(chore)}>
                <CoinIcon size={20} />
                <span>{getDisplayedCoinValue(chore)}</span>
              </span>
            </div>
          </div>
        </div>
        <ModalShell
          open={canManageActions && confirmDeleteOpen}
          onRequestClose={() => setConfirmDeleteOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="modal-dialog-title-row mb-2">
              <h3 className="text-lg font-bold text-slate-800">Delete Chore</h3>
              <Button
                type="button"
                className="modal-close-button"
                onClick={() => setConfirmDeleteOpen(false)}
                aria-label="Close dialog"
                title="Close dialog">
                X
              </Button>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              Delete <strong>{chore.title}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                disabled={disabled}
                onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                disabled={disabled}
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  void onDelete(chore.id);
                }}>
                {busyAction === "delete" ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </ModalShell>
        <div className="today-chore-action-group flex items-stretch gap-0">
          <Button
            type="button"
            className={`btn btn-secondary today-chore-complete-btn h-10 disabled:cursor-not-allowed disabled:opacity-60${
              canManageActions ? " flex-1" : " w-full"
            }`}
            disabled={disabled || !canComplete}
            onClick={(event) =>
              void onComplete(chore.id, {
                clientX: event.clientX,
                clientY: event.clientY,
              })
            }>
            <span aria-hidden="true" className="text-lg leading-none">
              &#x2713;
            </span>
            {busyAction === "complete"
              ? "Marking..."
              : canComplete
                ? isMultiOrFamilyAssignee && isAdminViewer
                  ? "Complete and Approve..."
                  : chore.requireApproval && isAdminViewer
                    ? "Complete and Approve"
                    : "Mark as Complete"
                : "Only assignee can complete"}
          </Button>
          {canManageActions ? (
            <AppMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              wrapperClassName="flex shrink-0 items-stretch self-stretch"
              triggerClassName="btn btn-secondary member-action-btn today-chore-options-btn h-10"
              triggerAriaLabel="Chore options"
              panelClassName="app-menu-panel family-action-dropdown today-chore-action-menu"
              trigger={<span className="text-lg leading-none">&#9776;</span>}>
              <MenuActionButton
                fullWidth
                onClick={() => {
                  setMenuOpen(false);
                  setEditDialogOpen(true);
                }}>
                Edit
              </MenuActionButton>
              <MenuActionButton
                fullWidth
                className="menu-action-link-danger"
                disabled={disabled}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDeleteOpen(true);
                }}>
                {busyAction === "delete" ? "Deleting..." : "Delete"}
              </MenuActionButton>
              <MenuActionButton
                fullWidth
                className="menu-action-divider-top"
                disabled={disabled || !canReorder || !canMoveUp}
                title={moveUpDisabledTitle}
                onClick={() => {
                  setMenuOpen(false);
                  void onMoveUp?.(chore.id);
                }}>
                Move Up
              </MenuActionButton>
              <MenuActionButton
                fullWidth
                disabled={disabled || !canReorder || !canMoveDown}
                title={moveDownDisabledTitle}
                onClick={() => {
                  setMenuOpen(false);
                  void onMoveDown?.(chore.id);
                }}>
                Move Down
              </MenuActionButton>
            </AppMenu>
          ) : null}
        </div>
      </div>
    </li>
  );
}





