"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { Button } from "@/components/button";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { ModalShell } from "@/components/modal-shell";
import type { FamilySnapshotChore } from "@/lib/family/types";

type TodayChoreCardProps = {
  chore: FamilySnapshotChore;
  isAdminViewer: boolean;
  canManageActions: boolean;
  canComplete: boolean;
  canReorder?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  dropIndicatorPosition?: "before" | "after" | null;
  busyAction: "" | "delete" | "complete";
  disabled: boolean;
  isExiting?: boolean;
  isCreatePending?: boolean;
  isDeletePending?: boolean;
  onDelete: (choreId: string) => Promise<void> | void;
  onComplete: (
    choreId: string,
    source?: { clientX: number; clientY: number },
  ) => Promise<void> | void;
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

export function TodayChoreCard({
  chore,
  isAdminViewer,
  canManageActions,
  canComplete,
  canReorder = false,
  isDragging = false,
  isDragOver = false,
  dropIndicatorPosition = null,
  busyAction,
  disabled,
  isExiting = false,
  isCreatePending = false,
  isDeletePending = false,
  onDelete,
  onComplete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdited,
}: TodayChoreCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const assigneePrimaryColor = getSafeHexColor(chore.assigneePrimaryColor);
  const assigneeAvatarId = chore.assigneeAvatarId?.trim() || "";
  const assigneeAvatarPhotoUrl = chore.assigneeAvatarPhotoUrl?.trim() || "";
  const isMultiOrFamilyAssignee =
    chore.assigneeScope === "family" || (chore.assigneeIds?.length ?? 0) > 1;

  function updateMenuPosition() {
    if (!triggerRef.current || typeof window === "undefined") {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const menuWidth = 128;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(rect.right - menuWidth, viewportWidth - menuWidth - margin),
    );
    setMenuPosition({
      top: rect.bottom + 6,
      left,
    });
  }

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
  }, [menuOpen]);

  return (
    <li
      className={`today-chore-item${isExiting ? " today-chore-item-exiting" : ""}${
        canReorder ? " is-draggable" : ""
      }${isDragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}${
        dropIndicatorPosition === "before" ? " is-drop-before" : ""
      }${dropIndicatorPosition === "after" ? " is-drop-after" : ""}${
        isCreatePending ? " is-create-pending" : ""
      }${isDeletePending ? " is-delete-pending" : ""}`}
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
      {isDeletePending ? (
        <span className="today-chore-loading-highlight today-chore-loading-highlight-red" aria-hidden="true" />
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
            />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="today-chore-title-row">
                <strong className="block break-words">{chore.title}</strong>
              </span>
              <span className="block break-words">{chore.assigneeName}</span>
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
              <span
                className="inline-flex items-center gap-1 text-lg font-bold leading-none text-amber-600"
                title={getCoinTooltip(chore)}>
                <CoinIcon size={20} />
                <span>{getDisplayedCoinValue(chore)}</span>
              </span>
              {canManageActions ? (
                <div className="relative" ref={triggerRef}>
                  <Button
                    type="button"
                    aria-label="Chore options"
                    aria-expanded={menuOpen}
                    className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    onClick={() => setMenuOpen((current) => !current)}>
                    <span className="text-lg leading-none">...</span>
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {canManageActions && menuOpen && menuPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-[90] mt-1 w-32 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                style={{ top: menuPosition.top, left: menuPosition.left }}>
                <Button
                  type="button"
                  className="block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditDialogOpen(true);
                  }}>
                  Edit
                </Button>
                <Button
                  type="button"
                  className="block w-full rounded px-2 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                  disabled={disabled}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}>
                  {busyAction === "delete" ? "Deleting..." : "Delete"}
                </Button>
              </div>,
              document.body,
            )
          : null}
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
        <Button
          type="button"
          className="btn btn-secondary h-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
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
      </div>
    </li>
  );
}






