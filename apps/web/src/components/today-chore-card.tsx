"use client";

import { useEffect, useRef, useState } from "react";
import { AddEditChoresDialog } from "@/components/add-edit-chores-dialog";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import type { FamilySnapshotChore } from "@/lib/family/types";

type TodayChoreCardProps = {
  chore: FamilySnapshotChore;
  canManageActions: boolean;
  canComplete: boolean;
  busyAction: "" | "delete" | "complete";
  disabled: boolean;
  onDelete: (choreId: string) => Promise<void> | void;
  onComplete: (choreId: string) => Promise<void> | void;
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

export function TodayChoreCard({
  chore,
  canManageActions,
  canComplete,
  busyAction,
  disabled,
  onDelete,
  onComplete,
  onEdited,
}: TodayChoreCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const assigneePrimaryColor = getSafeHexColor(chore.assigneePrimaryColor);
  const assigneeAvatarId = chore.assigneeAvatarId?.trim() || "";
  const assigneeAvatarPhotoUrl = chore.assigneeAvatarPhotoUrl?.trim() || "";

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
    <li>
      <AddEditChoresDialog
        chore={{
          id: chore.id,
          title: chore.title,
          assigneeId: chore.assigneeId,
          dueDate: chore.dueDate,
          details: chore.details,
        }}
        onSaved={onEdited}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        hideTrigger
      />
      <div
        className="flex flex-col gap-3 rounded-lg border-l-4 pl-3"
        style={{
          borderLeftColor: assigneePrimaryColor || "#cbd5e1",
        }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-label={`${chore.assigneeName} avatar`}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold"
              style={{
                borderColor: assigneePrimaryColor || "#e2e8f0",
                backgroundColor: assigneePrimaryColor || "#f1f5f9",
                color: assigneePrimaryColor ? "#ffffff" : "#334155",
              }}>
              {assigneeAvatarPhotoUrl ? (
                <img
                  src={assigneeAvatarPhotoUrl}
                  alt={`${chore.assigneeName} avatar`}
                  className="h-full w-full rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : assigneeAvatarId ? (
                <img
                  src={`/avatars/default/${encodeURIComponent(assigneeAvatarId)}`}
                  alt={`${chore.assigneeName} avatar`}
                  className="h-full w-full rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                chore.assigneeName?.trim().charAt(0).toUpperCase() || "?"
              )}
            </span>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <strong className="block">{chore.title}</strong>
              <span className="block">{chore.assigneeName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-lg font-bold leading-none text-amber-600">
              <span aria-hidden="true" className="text-xl leading-none">
                &#x1FA99;
              </span>
              {chore.coinValue}
            </span>
            {canManageActions ? (
              <div className="relative" ref={menuRef}>
                <Button
                  type="button"
                  aria-label="Chore options"
                  aria-expanded={menuOpen}
                  className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  onClick={() => setMenuOpen((current) => !current)}>
                  <span className="text-lg leading-none">...</span>
                </Button>
                {menuOpen ? (
                  <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
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
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <ModalShell
          open={canManageActions && confirmDeleteOpen}
          onRequestClose={() => setConfirmDeleteOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-slate-800">Delete Chore</h3>
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
          onClick={() => void onComplete(chore.id)}>
          <span aria-hidden="true" className="text-lg leading-none">
            &#x2713;
          </span>
          {busyAction === "complete"
            ? "Marking..."
            : canComplete
              ? "Mark as Complete"
              : "Only assignee can complete"}
        </Button>
      </div>
    </li>
  );
}
