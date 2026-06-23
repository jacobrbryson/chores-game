"use client";

import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/button";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";
import { ResponsibilityProgressCard } from "@/components/responsibility-progress-card";
import { useLocale } from "@/components/locale-provider";
import Link from "next/link";
import { CSSProperties, type ReactNode, useState } from "react";
import {
  RoutineBadgeIcon,
  RoutineProgressDialog,
} from "@/components/routine-progress-dialog";
import { recurrenceShortLabel } from "@/lib/chores/recurrence";
import type { FamilySnapshotChore } from "@/lib/family/types";
import { RESPONSIBILITY_PILLAR_EMOJI } from "@/lib/responsibility/types";
import { shouldHideChoreCoinValue } from "@packages/core";

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
  busyAction: "" | "delete" | "delete_routine" | "complete" | "skip";
  disabled: boolean;
  isExiting?: boolean;
  isCreatePending?: boolean;
  onDelete: (choreId: string) => Promise<void> | void;
  onDeleteRoutine?: (assignmentId: string, choreId: string) => Promise<void> | void;
  onComplete: (
    choreId: string,
    source?: { clientX: number; clientY: number },
  ) => Promise<void> | void;
  onSkip?: (choreId: string) => Promise<void> | void;
  onMoveUp?: (choreId: string) => Promise<void> | void;
  onMoveDown?: (choreId: string) => Promise<void> | void;
  onDragStart?: (choreId: string) => void;
  onDragOver?: (choreId: string, position: "before" | "after") => void;
  onDrop?: (choreId: string, position: "before" | "after") => void;
  onDragEnd?: () => void;
  onEdited: () => Promise<void> | void;
  progressMemberId?: string;
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
  if (shouldHideChoreCoinValue(chore)) {
    return "-";
  }
  return String(chore.coinValue ?? 0);
}

function getCoinTooltip(chore: Pick<FamilySnapshotChore, "choreType" | "status" | "coinValue">) {
  if (shouldHideChoreCoinValue(chore)) {
    return "See and Do chore types will have coins assigned during parent approval";
  }
  return undefined;
}

function isRecurringChore(
  chore: Pick<FamilySnapshotChore, "recurrenceType">,
) {
  return Boolean(chore.recurrenceType) && chore.recurrenceType !== "none";
}

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round">
      {children}
    </svg>
  );
}

const skipMenuIcon = (
  <MenuIcon>
    <path d="M5 5.5l6 4.5-6 4.5z" fill="currentColor" stroke="none" />
    <path d="M14 5.5v9" />
  </MenuIcon>
);

const editMenuIcon = (
  <MenuIcon>
    <path d="M13.5 4.5l2 2L7 15l-2.5.5L5 13z" />
    <path d="M12 6l2 2" />
  </MenuIcon>
);

const deleteMenuIcon = (
  <MenuIcon>
    <path d="M4.5 6h11" />
    <path d="M8 6V4.5h4V6" />
    <path d="M6 6l.6 9h6.8L14 6" />
    <path d="M8.5 9v3.5M11.5 9v3.5" />
  </MenuIcon>
);

const moveUpMenuIcon = (
  <MenuIcon>
    <path d="M10 15.5V5" />
    <path d="M5.5 9.5L10 5l4.5 4.5" />
  </MenuIcon>
);

const moveDownMenuIcon = (
  <MenuIcon>
    <path d="M10 4.5V15" />
    <path d="M5.5 10.5L10 15l4.5-4.5" />
  </MenuIcon>
);

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
  onDeleteRoutine,
  onComplete,
  onSkip,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdited,
  progressMemberId,
}: TodayChoreCardProps) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  // Recurrence indicator starts collapsed (calendar icon) and toggles to the
  // frequency label on click. Local component state means a list reload/refresh
  // naturally resets every row back to the icon, as required.
  const [showRecurrenceFrequency, setShowRecurrenceFrequency] = useState(false);
  // Pillar chip mirrors the recurrence chip: collapsed (emoji only) until
  // clicked, expanded shows the localized pillar name; local state resets on
  // list reload.
  const [showPillarLabel, setShowPillarLabel] = useState(false);
  const [routineDialogOpen, setRoutineDialogOpen] = useState(false);
  const recurring = isRecurringChore(chore);
  const pillar = chore.responsibilityPillar;
  const routineAssignmentId = chore.routineAssignmentId ?? "";
  const isRoutineStep = Boolean(routineAssignmentId);
  // Routine steps can be skipped (already done elsewhere, or not needed today):
  // the step closes out with no coins, and the routine still pays its
  // completion bonus as long as at least one step was actually completed.
  const canSkipStep = Boolean(routineAssignmentId) && canComplete && Boolean(onSkip);
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
      return recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: chore.recurrenceInterval,
        recurrenceUnit: chore.recurrenceUnit,
        recurrenceDays: chore.recurrenceDays,
      });
    }
    return t("dashboard.recurrenceCustom");
  }

  const recurrenceToggleLabel = showRecurrenceFrequency
    ? t("dashboard.recurringHideFrequency")
    : t("dashboard.recurringShowFrequency");
  const pillarName = pillar ? t(`responsibility.pillars.${pillar}`) : "";
  const pillarToggleLabel = showPillarLabel
    ? t("dashboard.pillarHideLabel", { pillar: pillarName })
    : t("dashboard.pillarShowLabel", { pillar: pillarName });
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
  const canOpenProgress = Boolean(progressMemberId) && !isMultiOrFamilyAssignee;

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
      {routineAssignmentId ? (
        <RoutineProgressDialog
          assignmentId={routineAssignmentId}
          open={routineDialogOpen}
          onRequestClose={() => setRoutineDialogOpen(false)}
          onChanged={onEdited}
        />
      ) : null}
      <ModalShell open={progressDialogOpen} onRequestClose={() => setProgressDialogOpen(false)}>
        <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
          <div className="modal-dialog-title-row mb-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">{chore.assigneeName}</h3>
            </div>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setProgressDialogOpen(false)}
              aria-label={t("common.actions.close")}
              title={t("common.actions.close")}>
              X
            </Button>
          </div>
          {progressMemberId ? <ResponsibilityProgressCard memberId={progressMemberId} /> : null}
        </div>
      </ModalShell>
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
          newSkillEnabled: chore.newSkillEnabled,
          recurrenceType: chore.recurrenceType,
          recurrenceInterval: chore.recurrenceInterval,
          recurrenceUnit: chore.recurrenceUnit,
          recurrenceDays: chore.recurrenceDays,
        }}
        onSaved={onEdited}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        hideTrigger
      />
      <div className="flex min-w-0 flex-col gap-3 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {canOpenProgress ? (
              <button
                type="button"
                className="today-chore-avatar-button"
                aria-label={`${t("responsibility.progress.title")}: ${chore.assigneeName}`}
                title={t("responsibility.progress.title")}
                onClick={(event) => {
                  event.stopPropagation();
                  setProgressDialogOpen(true);
                }}>
                <FamilyMemberAvatar
                  className="today-chore-avatar text-sm font-semibold"
                  size={32}
                  borderWidth={1}
                  name={chore.assigneeName}
                  avatarId={assigneeAvatarId}
                  avatarPhotoUrl={assigneeAvatarPhotoUrl}
                  primaryColor={assigneePrimaryColor || undefined}
                  isFamily={false}
                />
              </button>
            ) : (
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
            )}
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
              {routineAssignmentId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700 hover:bg-sky-200"
                  title={t("responsibility.routineBadgeTooltip", {
                    name: chore.routineName ?? "",
                  })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRoutineDialogOpen(true);
                  }}>
                  <RoutineBadgeIcon size={13} />
                  <span className="max-w-40 truncate">{chore.routineName}</span>
                  {chore.routineStepOrder && chore.routineStepCount ? (
                    <span>
                      {chore.routineStepOrder}/{chore.routineStepCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
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
              {pillar ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  aria-label={pillarToggleLabel}
                  aria-pressed={showPillarLabel}
                  title={pillarToggleLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowPillarLabel((value) => !value);
                  }}>
                  <span aria-hidden="true">{RESPONSIBILITY_PILLAR_EMOJI[pillar]}</span>
                  {showPillarLabel ? <span>{pillarName}</span> : null}
                </button>
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
              <h3 className="text-lg font-bold text-slate-800">
                {isRoutineStep ? t("dashboard.deleteRoutineStepTitle") : "Delete Chore"}
              </h3>
              <Button
                type="button"
                className="modal-close-button"
                onClick={() => setConfirmDeleteOpen(false)}
                aria-label="Close dialog"
                title="Close dialog">
                X
              </Button>
            </div>
            {isRoutineStep ? (
              <>
                <p className="mb-3 text-sm text-slate-600">
                  {t("dashboard.deleteRoutineStepBody", {
                    title: chore.title,
                    routine: chore.routineName ?? "",
                  })}
                </p>
                <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  {t("dashboard.deleteRoutineStepNote")}{" "}
                  <Link
                    href="/routines"
                    className="font-semibold underline hover:text-sky-900"
                    onClick={() => setConfirmDeleteOpen(false)}>
                    {t("dashboard.deleteRoutineStepNoteLink")}
                  </Link>
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                    disabled={disabled}
                    onClick={() => setConfirmDeleteOpen(false)}>
                    {t("common.actions.cancel")}
                  </Button>
                  <Button
                    type="button"
                    className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
                    disabled={disabled}
                    onClick={() => {
                      setConfirmDeleteOpen(false);
                      void onDelete(chore.id);
                    }}>
                    {busyAction === "delete"
                      ? t("dashboard.deleteRoutineStepBusy")
                      : t("dashboard.deleteThisStep")}
                  </Button>
                  <Button
                    type="button"
                    className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                    disabled={disabled}
                    onClick={() => {
                      setConfirmDeleteOpen(false);
                      void onDeleteRoutine?.(routineAssignmentId, chore.id);
                    }}>
                    {busyAction === "delete_routine"
                      ? t("dashboard.deleteEntireRoutineBusy")
                      : t("dashboard.deleteEntireRoutine")}
                  </Button>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </ModalShell>
        <ModalShell open={confirmSkipOpen} onRequestClose={() => setConfirmSkipOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="modal-dialog-title-row mb-2">
              <h3 className="text-lg font-bold text-slate-800">{t("dashboard.skipStepTitle")}</h3>
              <Button
                type="button"
                className="modal-close-button"
                onClick={() => setConfirmSkipOpen(false)}
                aria-label={t("common.actions.close")}
                title={t("common.actions.close")}>
                X
              </Button>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              {t("dashboard.skipStepConfirm", { title: chore.title })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                disabled={disabled}
                onClick={() => setConfirmSkipOpen(false)}>
                {t("common.actions.cancel")}
              </Button>
              <Button
                type="button"
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700"
                disabled={disabled}
                onClick={() => {
                  setConfirmSkipOpen(false);
                  void onSkip?.(chore.id);
                }}>
                {busyAction === "skip" ? t("dashboard.skipStepBusy") : t("dashboard.skipStepConfirmAction")}
              </Button>
            </div>
          </div>
        </ModalShell>
        <div className="today-chore-action-group flex items-stretch gap-0">
          <Button
            type="button"
            className={`btn btn-secondary today-chore-complete-btn h-10 disabled:cursor-not-allowed disabled:opacity-60${
              canManageActions || canSkipStep ? " flex-1" : " w-full"
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
          {canManageActions || canSkipStep ? (
            <AppMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              wrapperClassName="flex shrink-0 items-stretch self-stretch"
              triggerClassName="btn btn-secondary member-action-btn today-chore-options-btn h-10"
              triggerAriaLabel="Chore options"
              panelClassName="app-menu-panel family-action-dropdown today-chore-action-menu"
              trigger={<span className="text-lg leading-none">&#9776;</span>}>
              {canSkipStep ? (
                <MenuActionButton
                  fullWidth
                  leading={skipMenuIcon}
                  disabled={disabled}
                  title={t("dashboard.skipStepTooltip")}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmSkipOpen(true);
                  }}>
                  {busyAction === "skip"
                    ? t("dashboard.skipStepBusy")
                    : t("dashboard.skipStepAction")}
                </MenuActionButton>
              ) : null}
              {canManageActions ? (
                <>
                  <MenuActionButton
                    fullWidth
                    leading={editMenuIcon}
                    className={canSkipStep ? "menu-action-divider-top" : ""}
                    onClick={() => {
                      setMenuOpen(false);
                      setEditDialogOpen(true);
                    }}>
                    Edit
                  </MenuActionButton>
                  <MenuActionButton
                    fullWidth
                    leading={deleteMenuIcon}
                    className="menu-action-link-danger"
                    disabled={disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDeleteOpen(true);
                    }}>
                    {busyAction === "delete" || busyAction === "delete_routine"
                      ? "Deleting..."
                      : "Delete"}
                  </MenuActionButton>
                  <MenuActionButton
                    fullWidth
                    leading={moveUpMenuIcon}
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
                    leading={moveDownMenuIcon}
                    disabled={disabled || !canReorder || !canMoveDown}
                    title={moveDownDisabledTitle}
                    onClick={() => {
                      setMenuOpen(false);
                      void onMoveDown?.(chore.id);
                    }}>
                    Move Down
                  </MenuActionButton>
                </>
              ) : null}
            </AppMenu>
          ) : null}
        </div>
      </div>
    </li>
  );
}





