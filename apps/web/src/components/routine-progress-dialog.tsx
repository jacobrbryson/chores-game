"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { responsibilityPillarLabel } from "@/lib/responsibility/labels";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

type AssignmentStep = {
  id: string;
  title: string;
  order: number;
  choreId: string;
  coinValue: number;
};

type AssignmentPayload = {
  assignment?: {
    id: string;
    routineName: string;
    pillar: ResponsibilityPillar | "";
    assigneeName: string;
    status: "active" | "completed";
    steps: AssignmentStep[];
    completedStepIds: string[];
    skippedStepIds: string[];
    completionBonusCoins: number;
  };
  completionBonusXp?: number;
  stepXp?: number;
  error?: string;
};

type RoutineProgressDialogProps = {
  assignmentId: string;
  open: boolean;
  onRequestClose: () => void;
  // Called after a step is completed from inside this dialog, so the opener
  // (dashboard, kiosk, chores page) can refresh its own list.
  onChanged?: () => void;
};

// Routine progress view, opened from the routine badge on a chore row. Players
// and parents see the same dialog. Each still-open or skipped step has a Done
// button so steps can be finished out of order, or a previously-skipped step
// can be picked back up — all while the routine is still in progress.
export function RoutineProgressDialog({
  assignmentId,
  open,
  onRequestClose,
  onChanged,
}: RoutineProgressDialogProps) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<AssignmentPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyChoreId, setBusyChoreId] = useState("");
  const [actionError, setActionError] = useState("");

  const loadAssignment = useCallback(async () => {
    const response = await fetch(`/api/routines/assignments/${assignmentId}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as AssignmentPayload;
    if (!response.ok) {
      throw new Error(body.error || "assignment_unavailable");
    }
    return body;
  }, [assignmentId]);

  useEffect(() => {
    if (!open || !assignmentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setActionError("");
    (async () => {
      try {
        const body = await loadAssignment();
        if (!cancelled) {
          setPayload(body);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "assignment_unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, assignmentId, loadAssignment]);

  // Marks a step done, or reverts a finished/skipped step, by patching the
  // underlying step chore. "complete" finishes an open or skipped step;
  // "undo_complete" / "unskip" send a resolved step back to open.
  async function runStepAction(
    choreId: string,
    action: "complete" | "undo_complete" | "unskip",
  ) {
    if (busyChoreId) {
      return;
    }
    setBusyChoreId(choreId);
    setActionError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `STEP_ACTION_HTTP_${response.status}`);
      }
      const refreshed = await loadAssignment();
      setPayload(refreshed);
      onChanged?.();
    } catch (stepError) {
      setActionError(stepError instanceof Error ? stepError.message : "step_action_failed");
    } finally {
      setBusyChoreId("");
    }
  }

  const assignment = payload?.assignment;
  const completed = new Set(assignment?.completedStepIds ?? []);
  const skipped = new Set(assignment?.skippedStepIds ?? []);
  const completedCount = (assignment?.steps ?? []).filter((step) =>
    completed.has(step.id),
  ).length;
  const skippedCount = (assignment?.steps ?? []).filter((step) =>
    skipped.has(step.id) && !completed.has(step.id),
  ).length;
  const totalCount = assignment?.steps.length ?? 0;

  return (
    <ModalShell open={open} onRequestClose={onRequestClose}>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="modal-dialog-title-row">
          <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <RoutineBadgeIcon />
            {assignment
              ? t("responsibility.progressDialog.title", { name: assignment.routineName })
              : t("responsibility.progressDialog.loadingTitle")}
          </h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onRequestClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>

        {error ? <Alert tone="warning">{t("responsibility.progressDialog.loadError")}</Alert> : null}
        {actionError ? (
          <Alert tone="warning">{t("responsibility.progressDialog.completeError")}</Alert>
        ) : null}
        {loading && !assignment ? (
          <p className="text-sm text-slate-500">{t("common.actions.loading")}</p>
        ) : null}

        {assignment ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="font-semibold">
                {t("responsibility.progressDialog.progress", {
                  done: String(completedCount),
                  total: String(totalCount),
                })}
              </span>
              <span className="text-slate-400" aria-hidden="true">
                •
              </span>
              <span>{assignment.assigneeName}</span>
              {skippedCount > 0 ? (
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  {t("responsibility.progressDialog.skipped", { count: String(skippedCount) })}
                </span>
              ) : null}
              {assignment.status === "completed" ? (
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  {t("responsibility.progressDialog.completed")}
                </span>
              ) : null}
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
              />
            </div>

            <ol className="flex flex-col gap-1.5">
              {assignment.steps.map((step) => {
                const done = completed.has(step.id);
                const isSkipped = !done && skipped.has(step.id);
                const isResolved = done || isSkipped;
                // While the routine is in progress, an open step can be finished
                // out of order, and a resolved step (done or skipped) can be
                // reverted back to open. Once the routine has closed out the
                // list is read-only.
                const isActive = assignment.status === "active";
                const busy = busyChoreId === step.choreId;
                return (
                  <li key={step.id} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                        done
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : isSkipped
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-slate-300 bg-white text-slate-400"
                      }`}>
                      {isResolved ? (
                        <CheckmarkWatermark
                          className={done ? "text-emerald-300" : "text-amber-300"}
                        />
                      ) : null}
                      <span className="relative">{step.order}</span>
                    </span>
                    <span
                      className={`min-w-0 break-words ${
                        isResolved ? "text-slate-400 line-through" : "text-slate-700"
                      }`}>
                      {step.title}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {isSkipped ? (
                        <span className="text-xs font-semibold text-amber-600">
                          {t("responsibility.progressDialog.skippedTag")}
                        </span>
                      ) : step.coinValue > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                          +{step.coinValue} <CoinIcon size={12} />
                        </span>
                      ) : null}
                      {isActive && !isResolved ? (
                        <IconActionButton
                          label={t("responsibility.progressDialog.markDone")}
                          tone="done"
                          busy={busy}
                          disabled={Boolean(busyChoreId)}
                          onClick={() => void runStepAction(step.choreId, "complete")}>
                          <StepDoneIcon />
                        </IconActionButton>
                      ) : null}
                      {isActive && isResolved ? (
                        <IconActionButton
                          label={t("responsibility.progressDialog.undo")}
                          tone="undo"
                          busy={busy}
                          disabled={Boolean(busyChoreId)}
                          onClick={() =>
                            void runStepAction(
                              step.choreId,
                              done ? "undo_complete" : "unskip",
                            )
                          }>
                          <StepUndoIcon />
                        </IconActionButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-col gap-1 border-t border-slate-100 pt-3 text-sm text-slate-600">
              {assignment.pillar ? (
                <span>
                  {t("responsibility.progressDialog.pillar")}{" "}
                  <span className="font-semibold">
                    {responsibilityPillarLabel(assignment.pillar, t)}
                  </span>
                </span>
              ) : null}
              {(payload?.completionBonusXp ?? 0) > 0 && assignment.pillar ? (
                <span>
                  {t("responsibility.progressDialog.bonusXp", {
                    xp: String(payload?.completionBonusXp ?? 0),
                  })}
                </span>
              ) : null}
              {assignment.completionBonusCoins > 0 ? (
                <span className="inline-flex items-center gap-1">
                  {t("responsibility.progressDialog.bonusCoins", {
                    coins: String(assignment.completionBonusCoins),
                  })}
                  <CoinIcon size={14} />
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}

// Small square icon button used for the per-step Done / Undo controls.
function IconActionButton({
  label,
  tone,
  busy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tone: "done" | "undo";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === "done"
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
      } ${busy ? "opacity-60" : ""}`}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}>
      {children}
    </Button>
  );
}

// Faint check sitting behind a step's number once it is resolved (done/skipped).
function CheckmarkWatermark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full opacity-70 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function StepDoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function StepUndoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M7.5 5.5L4 9l3.5 3.5" />
      <path d="M4 9h7.5a4.5 4.5 0 0 1 0 9H7" />
    </svg>
  );
}

// Shared 📋-style icon for routine badges; inline SVG keeps it crisp and
// theme-colorable everywhere (dashboard rows, kiosk, dialogs).
export function RoutineBadgeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5h6v3H9z" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5" />
    </svg>
  );
}
