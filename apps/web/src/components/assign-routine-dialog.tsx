"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import {
  RoutineStepsEditor,
  resolveStepChore,
  useChoreCatalog,
  type RoutineEditableStep,
} from "@/components/routine-steps-editor";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  DEFAULT_RECURRENCE_INTERVAL,
  type ChoreRecurrenceType,
  type ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";
import {
  responsibilityPillarLabel,
  responsibilityPillarSelectOptions,
} from "@/lib/responsibility/labels";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

type RoutineTemplate = {
  id: string;
  name: string;
  description: string;
  pillar: ResponsibilityPillar | "";
  steps: Array<{ id: string; title: string; coinValue?: number; requireApproval?: boolean }>;
  completionBonusCoins: number;
  active: boolean;
  timesUsed: number;
};

type RoutineMember = {
  id: string;
  name: string;
  role: "admin" | "player";
};

type RoutinesPayload = {
  routines?: RoutineTemplate[];
  members?: RoutineMember[];
  error?: string;
};

type AssignRoutineDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => Promise<void> | void;
  defaultAssigneeId?: string;
  // Pre-select a routine (used by the /routines page "Assign" action).
  initialRoutineId?: string;
};

// The Routine Assignment workflow: pick a routine by name (autocomplete) or
// create a new one, then add/remove the chores that make it up. Per-chore
// details (coins, approval, due date) deliberately have no fields here — they
// come from the family's existing chores with the same names. When an
// existing routine's chores were customized, a checkbox decides whether the
// saved routine is updated; left unchecked, the customization is saved as a
// NEW routine so the original is never overwritten.
export function AssignRoutineDialog({
  open,
  onOpenChange,
  onAssigned,
  defaultAssigneeId,
  initialRoutineId,
}: AssignRoutineDialogProps) {
  const { t } = useLocale();
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [members, setMembers] = useState<RoutineMember[]>([]);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedRoutineId, setSelectedRoutineId] = useState("");
  const [steps, setSteps] = useState<RoutineEditableStep[]>([]);
  const [stepsModified, setStepsModified] = useState(false);
  const { choreCatalog, choreCatalogByTitle } = useChoreCatalog(open);
  const [updateRoutine, setUpdateRoutine] = useState(false);
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? "");
  const [recurrenceType, setRecurrenceType] = useState<ChoreRecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState(
    String(DEFAULT_RECURRENCE_INTERVAL),
  );
  const [recurrenceUnit, setRecurrenceUnit] = useState<ChoreRecurrenceUnit>("day");
  const [bonusCoins, setBonusCoins] = useState("0");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newRoutinePillar, setNewRoutinePillar] = useState<ResponsibilityPillar | "">("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedRoutine = useMemo(
    () => routines.find((routine) => routine.id === selectedRoutineId) ?? null,
    [routines, selectedRoutineId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/routines", { cache: "no-store" });
        const payload = (await response.json()) as RoutinesPayload;
        if (!response.ok) {
          throw new Error(payload.error || "routines_unavailable");
        }
        if (cancelled) {
          return;
        }
        setRoutines(payload.routines ?? []);
        setMembers((payload.members ?? []).filter((member) => member.id));
        setLoadError("");
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "routines_unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset per-open state so a reopened dialog always starts fresh.
  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch("");
    setSelectedRoutineId("");
    setSteps([]);
    setStepsModified(false);
    setUpdateRoutine(false);
    setAssigneeId(defaultAssigneeId ?? "");
    setRecurrenceType("none");
    setRecurrenceInterval(String(DEFAULT_RECURRENCE_INTERVAL));
    setRecurrenceUnit("day");
    setBonusCoins("0");
    setCreatingNew(false);
    setNewRoutinePillar("");
    setSubmitError("");
  }, [open, defaultAssigneeId]);

  // Pre-select the routine when launched from a specific template.
  useEffect(() => {
    if (!open || !initialRoutineId || routines.length === 0 || selectedRoutineId) {
      return;
    }
    const routine = routines.find((entry) => entry.id === initialRoutineId);
    if (routine) {
      selectRoutine(routine);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRoutineId, routines]);

  function selectRoutine(routine: RoutineTemplate) {
    setSelectedRoutineId(routine.id);
    setSearch(routine.name);
    setSteps(
      routine.steps.map((step) => ({
        id: step.id,
        title: step.title,
        coinValue: step.coinValue,
        requireApproval: step.requireApproval,
      })),
    );
    setStepsModified(false);
    setUpdateRoutine(false);
    setBonusCoins(String(routine.completionBonusCoins ?? 0));
    setCreatingNew(false);
    setSuggestionsOpen(false);
  }

  function startNewRoutine() {
    // Keep whatever chores are already listed — the admin may build the list
    // first and name the routine after.
    setSelectedRoutineId("");
    setCreatingNew(true);
    setUpdateRoutine(false);
    setSuggestionsOpen(false);
  }

  const filteredRoutines = useMemo(() => {
    const query = search.trim().toLowerCase();
    const candidates = routines.filter((routine) => routine.active);
    if (!query) {
      return candidates.slice(0, 8);
    }
    return candidates
      .filter((routine) => routine.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [routines, search]);

  const exactMatch = routines.some(
    (routine) => routine.name.trim().toLowerCase() === search.trim().toLowerCase(),
  );

  const memberOptions = useMemo<TailwindSelectOption<string>[]>(
    () => [
      { value: "", label: t("responsibility.assignDialog.choosePlayer") },
      ...members.map((member) => ({ value: member.id, label: member.name })),
    ],
    [members, t],
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

  const recurrenceUnitOptions = useMemo<TailwindSelectOption<ChoreRecurrenceUnit>[]>(
    () => [
      { value: "day", label: t("chores.recurrence.unitDays") },
      { value: "week", label: t("chores.recurrence.unitWeeks") },
      { value: "month", label: t("chores.recurrence.unitMonths") },
    ],
    [t],
  );

  const pillarOptions = useMemo(
    () => responsibilityPillarSelectOptions(t),
    [t],
  );
  const selectedRoutineBonusCoins = selectedRoutine?.completionBonusCoins ?? 0;
  const hasRoutineCustomizations =
    stepsModified || Number(bonusCoins) !== selectedRoutineBonusCoins;

  function markStepsModified(next: RoutineEditableStep[]) {
    setSteps(next);
    setStepsModified(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) {
      return;
    }
    const trimmedSteps = steps
      .map((step) => {
        const resolved = resolveStepChore(step, choreCatalogByTitle);
        return {
          id: step.id,
          title: step.title.trim(),
          coinValue: resolved.coinValue,
          requireApproval: resolved.requireApproval,
        };
      })
      .filter((step) => step.title);
    const routineName = search.trim().replace(/\s+/g, " ");
    const parsedBonusCoins = Number(bonusCoins);
    const normalizedBonusCoins =
      Number.isFinite(parsedBonusCoins) && parsedBonusCoins >= 0
        ? Math.min(1000, Math.trunc(parsedBonusCoins))
        : 0;
    const bonusCoinsChanged =
      selectedRoutine !== null && normalizedBonusCoins !== selectedRoutineBonusCoins;
    const customizedRoutineSettings = stepsModified || bonusCoinsChanged;
    if ((!selectedRoutineId && !routineName) || trimmedSteps.length === 0 || !assigneeId) {
      setSubmitError(t("responsibility.assignDialog.validation"));
      return;
    }
    setSaving(true);
    setSubmitError("");
    try {
      async function createRoutine(name: string, pillar: string) {
        const createResponse = await fetch("/api/routines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            pillar,
            steps: trimmedSteps,
            completionBonusCoins: normalizedBonusCoins,
          }),
        });
        const createPayload = (await createResponse.json()) as {
          routineId?: string;
          error?: string;
        };
        if (!createResponse.ok || !createPayload.routineId) {
          throw new Error(createPayload.error || "create_routine_failed");
        }
        return createPayload.routineId;
      }

      let routineId = selectedRoutineId;
      if (!routineId) {
        // The admin typed a name without clicking a suggestion. An exact
        // match assigns from that saved routine (with the chores listed
        // here); otherwise the typed name becomes a new routine.
        const match = routines.find(
          (routine) => routine.name.trim().toLowerCase() === routineName.toLowerCase(),
        );
        routineId = match ? match.id : await createRoutine(routineName, newRoutinePillar);
      } else if (customizedRoutineSettings && !updateRoutine && selectedRoutine) {
        // Customized an existing routine without opting into overwriting it:
        // save the customization as a NEW routine so the original survives.
        routineId = await createRoutine(
          t("responsibility.routines.customCopyName", { name: selectedRoutine.name }).slice(
            0,
            120,
          ),
          selectedRoutine.pillar,
        );
      }

      const response = await fetch(`/api/routines/${routineId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeId,
          recurrenceType,
          ...(recurrenceType === "custom"
            ? {
                recurrenceInterval: Number(recurrenceInterval) || DEFAULT_RECURRENCE_INTERVAL,
                recurrenceUnit,
              }
            : {}),
          steps: trimmedSteps,
          completionBonusCoins: normalizedBonusCoins,
          updateRoutine:
            updateRoutine && customizedRoutineSettings && routineId === selectedRoutineId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "assign_routine_failed");
      }
      onOpenChange(false);
      await onAssigned();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "assign_routine_failed");
    } finally {
      setSaving(false);
    }
  }

  // A new routine will be created when the typed name doesn't match a saved
  // one — surface the pillar picker for it.
  const willCreateNewRoutine =
    !selectedRoutineId && (creatingNew || (search.trim() !== "" && !exactMatch));

  return (
    <ModalShell open={open} onRequestClose={() => onOpenChange(false)}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="modal-dialog-title-row">
          <h3 className="text-lg font-bold text-slate-800">
            {t("responsibility.assignDialog.title")}
          </h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={() => onOpenChange(false)}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>

        {loadError ? (
          <Alert tone="warning">{t("responsibility.routines.loadError")}</Alert>
        ) : null}
        {submitError ? <Alert tone="warning">{submitError}</Alert> : null}

        {/* Step 1: routine name autocomplete */}
        <label className="relative flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("responsibility.assignDialog.routineLabel")}
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            maxLength={120}
            placeholder={t("responsibility.assignDialog.routinePlaceholder")}
            onChange={(event) => {
              setSearch(event.target.value);
              setSuggestionsOpen(true);
              // Editing the name detaches from the selected template but
              // keeps the chore list the admin already has.
              if (selectedRoutineId) {
                setSelectedRoutineId("");
              }
              if (creatingNew) {
                setCreatingNew(false);
              }
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              // Delay so option mousedown can land first.
              window.setTimeout(() => setSuggestionsOpen(false), 150);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              const match = routines.find(
                (routine) =>
                  routine.name.trim().toLowerCase() === search.trim().toLowerCase(),
              );
              if (match) {
                selectRoutine(match);
              } else if (search.trim()) {
                startNewRoutine();
              }
            }}
            className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
          />
          {suggestionsOpen && (filteredRoutines.length > 0 || search.trim()) ? (
            <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {filteredRoutines.map((routine) => (
                <button
                  key={routine.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectRoutine(routine);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-800">{routine.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {t("responsibility.assignDialog.stepCount", {
                      count: String(routine.steps.length),
                    })}
                    {routine.pillar
                      ? ` · ${responsibilityPillarLabel(routine.pillar, t)}`
                      : ""}
                  </span>
                </button>
              ))}
              {search.trim() && !exactMatch ? (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    startNewRoutine();
                  }}
                  className="w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-blue-600 hover:bg-slate-50">
                  {t("responsibility.assignDialog.createNew", { name: search.trim() })}
                </button>
              ) : null}
            </div>
          ) : null}
        </label>

        {willCreateNewRoutine ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("responsibility.choreDialog.label")}
            </span>
            <TailwindSelect
              ariaLabel={t("responsibility.choreDialog.label")}
              value={newRoutinePillar}
              onChange={(value) => setNewRoutinePillar(value as ResponsibilityPillar | "")}
              options={pillarOptions}
              className="w-full"
              buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              menuClassName="border-slate-300"
            />
          </label>
        ) : null}

        {/* Who gets the routine and how often it repeats. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("responsibility.assignDialog.playerLabel")}
            </span>
            <TailwindSelect
              ariaLabel={t("responsibility.assignDialog.playerLabel")}
              value={assigneeId}
              onChange={(value) => setAssigneeId(value)}
              options={memberOptions}
              className="w-full"
              buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              menuClassName="border-slate-300"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("responsibility.assignDialog.recurrenceLabel")}
            </span>
            <TailwindSelect
              ariaLabel={t("responsibility.assignDialog.recurrenceLabel")}
              value={recurrenceType}
              onChange={(value) => setRecurrenceType(value as ChoreRecurrenceType)}
              options={recurrenceOptions}
              className="w-full"
              buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              menuClassName="border-slate-300"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">
              {t("responsibility.routines.bonusCoinsLabel")}
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={bonusCoins}
              onChange={(event) => setBonusCoins(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 px-3 text-slate-800"
            />
          </label>
        </div>

        {recurrenceType === "custom" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">
                {t("chores.recurrence.intervalLabel")}
              </span>
              <input
                type="number"
                min={1}
                max={365}
                value={recurrenceInterval}
                onChange={(event) => setRecurrenceInterval(event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 px-3 text-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">
                {t("chores.recurrence.unitLabel")}
              </span>
              <TailwindSelect
                ariaLabel={t("chores.recurrence.unitLabel")}
                value={recurrenceUnit}
                onChange={(value) => setRecurrenceUnit(value as ChoreRecurrenceUnit)}
                options={recurrenceUnitOptions}
                className="w-full"
                buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                menuClassName="border-slate-300"
              />
            </label>
          </div>
        ) : null}

        {/* The routine's chore list — always available to manage. */}
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                {t("responsibility.assignDialog.stepsHeading")}
              </span>
              {selectedRoutine?.pillar ? (
                <span className="text-xs font-medium text-slate-500">
                  {responsibilityPillarLabel(selectedRoutine.pillar, t)}
                </span>
              ) : null}
            </div>
            <RoutineStepsEditor
              steps={steps}
              onChange={markStepsModified}
              choreCatalog={choreCatalog}
              choreCatalogByTitle={choreCatalogByTitle}
              showNewChoreBadge={false}
            />

            {/* Customized an existing routine: update it, or (unchecked)
                save the changes as a new routine so the original is kept. */}
            {selectedRoutineId && hasRoutineCustomizations ? (
              <label className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={updateRoutine}
                  onChange={(event) => setUpdateRoutine(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span className="flex flex-col text-sm text-slate-700">
                  {t("responsibility.assignDialog.updateRoutine")}
                  <span className="text-xs text-slate-500">
                    {t("responsibility.assignDialog.updateRoutineHint")}
                  </span>
                </span>
              </label>
            ) : null}
          </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? t("common.actions.saving")
              : t("responsibility.assignDialog.assignAction")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
