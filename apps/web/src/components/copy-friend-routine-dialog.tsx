"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import {
  CustomRecurrenceDialog,
  customRecurrenceSummary,
} from "@/components/custom-recurrence-dialog";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import {
  RoutineStepsEditor,
  resolveStepChore,
  useChoreCatalog,
  type RoutineEditableStep,
} from "@/components/routine-steps-editor";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import type {
  ChoreRecurrenceType,
  ChoreRecurrenceUnit,
  ChoreRecurrenceWeekday,
} from "@/lib/chores/recurrence";

type RoutineMember = {
  id: string;
  name: string;
  role: "admin" | "player";
  status: "active" | "invited";
};

type CopyFriendRoutineDialogProps = {
  open: boolean;
  sourceFamilyId: string;
  sourceFamilyName: string;
  sourceRoutineId: string;
  routineName: string;
  onOpenChange: (open: boolean) => void;
  onCopied: (assigned: boolean) => void;
};

type RoutinePreview = {
  id: string;
  name: string;
  steps: Array<{ id: string; title: string; coinValue?: number; requireApproval?: boolean }>;
};

export function CopyFriendRoutineDialog({
  open,
  sourceFamilyId,
  sourceFamilyName,
  sourceRoutineId,
  routineName,
  onOpenChange,
  onCopied,
}: CopyFriendRoutineDialogProps) {
  const { t } = useLocale();
  const [members, setMembers] = useState<RoutineMember[]>([]);
  const [assignNow, setAssignNow] = useState(true);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<RoutineEditableStep[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { choreCatalog, choreCatalogByTitle } = useChoreCatalog(open);
  const [recurrenceType, setRecurrenceType] = useState<ChoreRecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceUnit, setRecurrenceUnit] = useState<ChoreRecurrenceUnit>("week");
  const [recurrenceDays, setRecurrenceDays] = useState<ChoreRecurrenceWeekday[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [copiedRoutineId, setCopiedRoutineId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAssignNow(true);
    setAssigneeIds([]);
    setAssignedIds([]);
    setSteps([]);
    setPreviewLoading(true);
    setRecurrenceType("none");
    setRecurrenceInterval("1");
    setRecurrenceUnit("week");
    setRecurrenceDays([]);
    setCopiedRoutineId("");
    setError("");
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ sourceFamilyId });
        if (sourceRoutineId) params.set("routineId", sourceRoutineId);
        if (routineName) params.set("routineName", routineName);
        const [membersResponse, previewResponse] = await Promise.all([
          fetch("/api/routines", { cache: "no-store" }),
          fetch(`/api/family-friends/routines/copy?${params.toString()}`, {
            cache: "no-store",
          }),
        ]);
        const membersPayload = (await membersResponse.json()) as {
          members?: RoutineMember[];
          error?: string;
        };
        const previewPayload = (await previewResponse.json()) as {
          routine?: RoutinePreview;
          error?: string;
        };
        if (!membersResponse.ok) {
          throw new Error(membersPayload.error || "routines_unavailable");
        }
        if (!previewResponse.ok || !previewPayload.routine) {
          throw new Error(previewPayload.error || "family_friend_routine_preview_failed");
        }
        if (!cancelled) {
          setMembers(
            (membersPayload.members ?? []).filter(
              (member) => member.id && member.status === "active",
            ),
          );
          setSteps(previewPayload.routine.steps);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "routines_unavailable");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, routineName, sourceFamilyId, sourceRoutineId]);

  const memberOptions = useMemo(
    () => members.map((member) => ({ value: member.id, label: member.name })),
    [members],
  );
  const recurrenceOptions = useMemo<TailwindSelectOption<ChoreRecurrenceType>[]>(
    () => [
      { value: "none", label: t("chores.recurrence.none") },
      { value: "daily", label: t("chores.recurrence.daily") },
      { value: "weekly", label: t("chores.recurrence.weekly") },
      { value: "monthly", label: t("chores.recurrence.monthly") },
      { value: "custom", label: t("chores.recurrence.custom") },
    ],
    [t],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const resolvedSteps = steps
      .map((step, index) => {
        const resolved = resolveStepChore(step, choreCatalogByTitle);
        return {
          id: step.id || `step_${index + 1}`,
          title: step.title.trim(),
          coinValue: resolved.coinValue,
          requireApproval: resolved.requireApproval,
        };
      })
      .filter((step) => step.title);
    if (resolvedSteps.length === 0) {
      setError(t("familyFriends.routines.chooseSteps"));
      return;
    }
    if (assignNow && assigneeIds.length === 0) {
      setError(t("familyFriends.routines.chooseAssignees"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      let routineId = copiedRoutineId;
      if (!routineId) {
        const copyResponse = await fetch("/api/family-friends/routines/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceFamilyId,
            routineId: sourceRoutineId,
            routineName,
            steps: resolvedSteps,
          }),
        });
        const copyPayload = (await copyResponse.json()) as { routineId?: string; error?: string };
        if (!copyResponse.ok || !copyPayload.routineId) {
          throw new Error(copyPayload.error || "family_friend_routine_copy_failed");
        }
        routineId = copyPayload.routineId;
        setCopiedRoutineId(routineId);
      }

      if (assignNow) {
        for (const assigneeId of assigneeIds) {
          if (assignedIds.includes(assigneeId)) continue;
          const assignResponse = await fetch(`/api/routines/${routineId}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assigneeId,
              recurrenceType,
              ...(recurrenceType === "custom"
                ? {
                    recurrenceInterval: Number(recurrenceInterval) || 1,
                    recurrenceUnit,
                    recurrenceDays,
                  }
                : {}),
            }),
          });
          const assignPayload = (await assignResponse.json()) as { error?: string };
          if (!assignResponse.ok) {
            throw new Error(assignPayload.error || "assign_routine_failed");
          }
          setAssignedIds((current) => [...current, assigneeId]);
        }
      }
      onCopied(assignNow);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "family_friend_routine_copy_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ModalShell open={open} onRequestClose={() => onOpenChange(false)}>
        <form onSubmit={handleSubmit} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="modal-dialog-title-row">
            <h3 className="text-lg font-bold text-slate-800">{t("familyFriends.routines.dialogTitle")}</h3>
            <Button type="button" className="modal-close-button" onClick={() => onOpenChange(false)} aria-label={t("common.actions.close")} title={t("common.actions.close")}>X</Button>
          </div>

          <p className="text-sm text-slate-700">
            {t("familyFriends.routines.confirmBody", {
              routine: routineName || t("familyFriends.routines.unnamed"),
              family: sourceFamilyName,
            })}
          </p>
          {error ? <Alert tone="warning">{t("familyFriends.errors.action", { error })}</Alert> : null}

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-700">
              {t("familyFriends.routines.previewHeading")}
            </span>
            {previewLoading ? (
              <div className="flex flex-col gap-2" aria-hidden="true">
                {[0, 1, 2].map((key) => (
                  <div key={key} className="family-skeleton h-8 w-full rounded-md" />
                ))}
              </div>
            ) : (
              <RoutineStepsEditor
                steps={steps}
                onChange={setSteps}
                choreCatalog={choreCatalog}
                choreCatalogByTitle={choreCatalogByTitle}
                showNewChoreBadge={false}
              />
            )}
          </div>

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" checked={assignNow} onChange={(event) => setAssignNow(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span className="text-sm font-medium text-slate-700">{t("familyFriends.routines.assignNow")}</span>
          </label>

          {assignNow ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("familyFriends.routines.assigneesLabel")}</span>
                <TailwindMultiSelect
                  ariaLabel={t("familyFriends.routines.assigneesLabel")}
                  values={assigneeIds}
                  onChange={setAssigneeIds}
                  options={memberOptions}
                  placeholder={t("familyFriends.routines.assigneesPlaceholder")}
                  className="w-full"
                  buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  menuClassName="border-slate-300"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("responsibility.assignDialog.recurrenceLabel")}</span>
                <TailwindSelect ariaLabel={t("responsibility.assignDialog.recurrenceLabel")} value={recurrenceType} onChange={(value) => value === "custom" ? setCustomOpen(true) : setRecurrenceType(value as ChoreRecurrenceType)} options={recurrenceOptions} className="w-full" buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50" menuClassName="border-slate-300" />
              </label>
            </div>
          ) : null}
          {assignNow && recurrenceType === "custom" ? (
            <Button type="button" className="btn btn-secondary" onClick={() => setCustomOpen(true)}>
              {customRecurrenceSummary(recurrenceInterval, recurrenceUnit, recurrenceDays, t)}
            </Button>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <span title={saving ? t("familyFriends.disabled.actionPending") : undefined}>
              <Button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)} disabled={saving}>{t("common.actions.cancel")}</Button>
            </span>
            <span title={saving ? t("familyFriends.disabled.actionPending") : previewLoading ? t("feed.loading") : undefined}>
              <Button type="submit" className="btn btn-primary" disabled={saving || previewLoading}>
                {saving ? t("familyFriends.routines.copying") : assignNow ? t("familyFriends.routines.copyAndAssign") : t("familyFriends.routines.copy")}
              </Button>
            </span>
          </div>
        </form>
      </ModalShell>
      <CustomRecurrenceDialog
        open={customOpen}
        interval={recurrenceInterval}
        unit={recurrenceUnit}
        days={recurrenceDays}
        onCancel={() => setCustomOpen(false)}
        onSave={(next) => {
          setRecurrenceType("custom");
          setRecurrenceInterval(next.interval);
          setRecurrenceUnit(next.unit);
          setRecurrenceDays(next.days);
          setCustomOpen(false);
        }}
      />
    </>
  );
}
