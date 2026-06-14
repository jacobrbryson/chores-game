"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { AssignRoutineDialog } from "@/components/assign-routine-dialog";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";
import {
  RoutineStepsEditor,
  useChoreCatalog,
  type RoutineEditableStep,
} from "@/components/routine-steps-editor";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  responsibilityPillarLabel,
  responsibilityPillarSelectOptions,
} from "@/lib/responsibility/labels";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

type RoutineStep = {
  id: string;
  title: string;
  coinValue?: number;
  requireApproval?: boolean;
};

type Routine = {
  id: string;
  name: string;
  description: string;
  pillar: ResponsibilityPillar | "";
  steps: RoutineStep[];
  completionBonusXp: number;
  completionBonusCoins: number;
  active: boolean;
  timesUsed: number;
  timesCompleted: number;
  updatedAt?: string;
  createdAt?: string;
};

type RoutinesPayload = {
  routines?: Routine[];
  members?: Array<{ id: string; name: string; role: "admin" | "player" }>;
  viewerRole?: "admin" | "player";
  error?: string;
};

// The /routines page: the family's reusable routine template library.
// Routines defined here are assigned to players from the chores dashboard
// ("+ Add → Routine") or directly via the Assign action on each row.
export function RoutinesPageClient() {
  const { t } = useLocale();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player">("player");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignRoutineId, setAssignRoutineId] = useState("");
  const [busyRoutineId, setBusyRoutineId] = useState("");
  const [openMenuRoutineId, setOpenMenuRoutineId] = useState("");
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);

  const loadRoutines = useCallback(async () => {
    try {
      const response = await fetch("/api/routines", { cache: "no-store" });
      const payload = (await response.json()) as RoutinesPayload;
      if (!response.ok) {
        throw new Error(payload.error || "routines_unavailable");
      }
      setRoutines(payload.routines ?? []);
      setViewerRole(payload.viewerRole === "admin" ? "admin" : "player");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "routines_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoutines();
  }, [loadRoutines]);

  async function deleteRoutine(routine: Routine) {
    if (!window.confirm(t("responsibility.routines.deleteConfirm"))) {
      return;
    }
    setBusyRoutineId(routine.id);
    try {
      const response = await fetch(`/api/routines/${routine.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("delete_routine_failed");
      }
      await loadRoutines();
    } catch {
      setError("delete_routine_failed");
    } finally {
      setBusyRoutineId("");
    }
  }

  async function duplicateRoutine(routine: Routine) {
    setBusyRoutineId(routine.id);
    try {
      const response = await fetch("/api/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("responsibility.routines.copyName", { name: routine.name }).slice(0, 120),
          description: routine.description,
          pillar: routine.pillar,
          steps: routine.steps.map((step) => ({ title: step.title })),
          completionBonusCoins: routine.completionBonusCoins,
          ...(routine.completionBonusXp >= 0
            ? { completionBonusXp: routine.completionBonusXp }
            : {}),
        }),
      });
      if (!response.ok) {
        throw new Error("duplicate_routine_failed");
      }
      await loadRoutines();
    } catch {
      setError("duplicate_routine_failed");
    } finally {
      setBusyRoutineId("");
    }
  }

  function formatDate(value?: string) {
    if (!value) {
      return "—";
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
  }

  const visibleRoutines = useMemo(
    () => routines.filter((routine) => viewerRole === "admin" || routine.active),
    [routines, viewerRole],
  );
  const isAdmin = viewerRole === "admin";
  function openCreateRoutine() {
    setEditingRoutine(null);
    setEditorOpen(true);
  }

  return (
    <section className="panel flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            {t("responsibility.routines.heading")}
          </h1>
          <p className="text-sm text-slate-500">{t("responsibility.routines.subheading")}</p>
        </div>
        {isAdmin ? (
          <Button className="btn btn-primary" onClick={openCreateRoutine}>
            {t("responsibility.routines.addRoutineAction")}
          </Button>
        ) : null}
      </header>

      {error ? <Alert tone="warning">{t("responsibility.routines.loadError")}</Alert> : null}

      {loading ? (
        <p className="text-sm text-slate-500">{t("common.actions.loading")}</p>
      ) : visibleRoutines.length === 0 ? (
        <div className="dashboard-empty-state">
          <span className="dashboard-empty-state-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M7 5.5h10" />
              <path d="M7 12h10" />
              <path d="M7 18.5h6" />
              <path d="M4 5.5h.01" />
              <path d="M4 12h.01" />
              <path d="M4 18.5h.01" />
              <path d="m16 18 1.5 1.5L21 16" />
            </svg>
          </span>
          <h4 className="dashboard-empty-state-title">
            {t("responsibility.routines.emptyTitle")}
          </h4>
          <p className="dashboard-empty-state-body">
            {t("responsibility.routines.emptyBody")}
          </p>
          {isAdmin ? (
            <div className="dashboard-empty-state-actions">
              <Button className="btn btn-primary" onClick={openCreateRoutine}>
                {t("responsibility.routines.createRoutine")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">{t("responsibility.routines.columnName")}</th>
                <th className="px-3 py-2">{t("responsibility.routines.columnPillar")}</th>
                <th className="px-3 py-2 text-center">
                  {t("responsibility.routines.columnSteps")}
                </th>
                <th className="px-3 py-2 text-center">
                  {t("responsibility.routines.columnTimesUsed")}
                </th>
                <th className="px-3 py-2">{t("responsibility.routines.columnUpdated")}</th>
                {isAdmin ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRoutines.map((routine) => (
                <tr
                  key={routine.id}
                  className="cursor-pointer border-b border-slate-100 align-middle hover:bg-slate-50 focus-within:bg-slate-50"
                  onClick={() => setSelectedRoutine(routine)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedRoutine(routine);
                    }
                  }}
                  tabIndex={0}>
                  <td className="px-3 py-3 align-middle">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-slate-800">{routine.name}</span>
                      {routine.description ? (
                        <span className="text-xs text-slate-500">{routine.description}</span>
                      ) : null}
                      <span className="flex gap-1">
                        {!routine.active && isAdmin ? (
                          <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {t("responsibility.routines.inactive")}
                          </span>
                        ) : null}
                        {routine.completionBonusCoins > 0 ? (
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            +{routine.completionBonusCoins}
                            <CoinIcon size={12} />
                            {t("responsibility.routines.bonusChip")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle text-slate-600">
                    {routine.pillar ? responsibilityPillarLabel(routine.pillar, t) : "—"}
                  </td>
                  <td className="px-3 py-3 align-middle text-center text-slate-600">
                    {routine.steps.length}
                  </td>
                  <td className="px-3 py-3 align-middle text-center text-slate-600">{routine.timesUsed}</td>
                  <td className="px-3 py-3 align-middle text-slate-600">
                    {formatDate(routine.updatedAt ?? routine.createdAt)}
                  </td>
                  {isAdmin ? (
                    <td
                      className="px-3 py-3 align-middle text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}>
                      <AppMenu
                        open={openMenuRoutineId === routine.id}
                        onOpenChange={(open) => {
                          setOpenMenuRoutineId(open ? routine.id : "");
                        }}
                        wrapperClassName="inline-flex"
                        triggerClassName="btn btn-secondary member-action-btn"
                        triggerAriaLabel={t("responsibility.routines.actionsAriaLabel")}
                        panelClassName="app-menu-panel family-action-dropdown"
                        trigger={<span className="text-lg leading-none">&#9776;</span>}>
                        <MenuActionButton
                          fullWidth
                          disabled={busyRoutineId === routine.id}
                          onClick={() => {
                            setOpenMenuRoutineId("");
                            setAssignRoutineId(routine.id);
                            setAssignDialogOpen(true);
                          }}>
                          {t("responsibility.routines.assignAction")}
                        </MenuActionButton>
                        <MenuActionButton
                          fullWidth
                          disabled={busyRoutineId === routine.id}
                          onClick={() => {
                            setOpenMenuRoutineId("");
                            setEditingRoutine(routine);
                            setEditorOpen(true);
                          }}>
                          {t("common.actions.edit")}
                        </MenuActionButton>
                        <MenuActionButton
                          fullWidth
                          disabled={busyRoutineId === routine.id}
                          onClick={() => {
                            setOpenMenuRoutineId("");
                            void duplicateRoutine(routine);
                          }}>
                          {t("responsibility.routines.duplicateAction")}
                        </MenuActionButton>
                        <MenuActionButton
                          fullWidth
                          className="menu-action-link-danger"
                          disabled={busyRoutineId === routine.id}
                          onClick={() => {
                            setOpenMenuRoutineId("");
                            void deleteRoutine(routine);
                          }}>
                          {t("common.actions.delete")}
                        </MenuActionButton>
                      </AppMenu>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen ? (
        <RoutineEditorModal
          routine={editingRoutine}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            setEditorOpen(false);
            await loadRoutines();
          }}
        />
      ) : null}

      {selectedRoutine ? (
        <RoutineStepsModal routine={selectedRoutine} onClose={() => setSelectedRoutine(null)} />
      ) : null}

      <AssignRoutineDialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) {
            setAssignRoutineId("");
          }
        }}
        onAssigned={loadRoutines}
        initialRoutineId={assignRoutineId || undefined}
      />
    </section>
  );
}

function RoutineStepsModal({
  routine,
  onClose,
}: {
  routine: Routine;
  onClose: () => void;
}) {
  const { t } = useLocale();

  return (
    <ModalShell open onRequestClose={onClose}>
      <section className="add-chores-modal-card flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="modal-dialog-title-row">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-slate-800">{routine.name}</h2>
            <p className="text-sm text-slate-500">
              {t("responsibility.assignDialog.stepCount", {
                count: String(routine.steps.length),
              })}
            </p>
          </div>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>

        {routine.description ? (
          <p className="text-sm leading-6 text-slate-600">{routine.description}</p>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            {t("responsibility.routines.stepsLabel")}
          </h3>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-700">
            {routine.steps.map((step, index) => (
              <li key={`${step.id || step.title}-${index}`} className="leading-6">
                {step.title}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <Button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.actions.close")}
          </Button>
        </div>
      </section>
    </ModalShell>
  );
}

function RoutineEditorModal({
  routine,
  onClose,
  onSaved,
}: {
  routine: Routine | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(routine?.name ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [pillar, setPillar] = useState<ResponsibilityPillar | "">(routine?.pillar ?? "");
  // Steps are real chores: existing template steps keep their ids so
  // in-flight assignments stay matched; chores added here are either picked
  // from the family's chore catalog or created new.
  const [steps, setSteps] = useState<RoutineEditableStep[]>(
    routine
      ? routine.steps.map((step) => ({
          id: step.id,
          title: step.title,
          coinValue: step.coinValue,
          requireApproval: step.requireApproval,
        }))
      : [],
  );
  const [bonusCoins, setBonusCoins] = useState(String(routine?.completionBonusCoins ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { choreCatalog, choreCatalogByTitle } = useChoreCatalog(true);

  const pillarOptions = useMemo<TailwindSelectOption<ResponsibilityPillar | "">[]>(
    () => responsibilityPillarSelectOptions(t),
    [t],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Explicitly set coins/approval persist on the template; untouched steps
    // keep inheriting from the family's chores at assignment time.
    const trimmedSteps = steps
      .map((step) => ({
        id: step.id,
        title: step.title.trim(),
        ...(step.coinValue !== undefined ? { coinValue: step.coinValue } : {}),
        ...(step.requireApproval !== undefined
          ? { requireApproval: step.requireApproval }
          : {}),
      }))
      .filter((step) => step.title);
    if (!name.trim() || trimmedSteps.length === 0) {
      setError(t("responsibility.routines.editorValidation"));
      return;
    }
    const parsedCoins = Number(bonusCoins);
    setSaving(true);
    setError("");
    try {
      const response = await fetch(routine ? `/api/routines/${routine.id}` : "/api/routines", {
        method: routine ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          pillar,
          steps: trimmedSteps,
          completionBonusCoins:
            Number.isFinite(parsedCoins) && parsedCoins >= 0 ? Math.trunc(parsedCoins) : 0,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "save_routine_failed");
      }
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "save_routine_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell open onRequestClose={onClose}>
      <form
        onSubmit={handleSubmit}
        className="add-chores-modal-card flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="modal-dialog-title-row mb-1">
          <h2 className="text-lg font-bold text-slate-800">
            {routine
              ? t("responsibility.routines.editRoutine")
              : t("responsibility.routines.addRoutine")}
          </h2>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>
        {error ? <Alert tone="warning">{error}</Alert> : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("responsibility.routines.nameLabel")}
          </span>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("responsibility.routines.descriptionLabel")}
          </span>
          <input
            type="text"
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("responsibility.choreDialog.label")}
          </span>
          <TailwindSelect
            ariaLabel={t("responsibility.choreDialog.label")}
            value={pillar}
            onChange={(value) => setPillar(value as ResponsibilityPillar | "")}
            options={pillarOptions}
            className="w-full"
            buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            menuClassName="border-slate-300"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">
            {t("responsibility.routines.stepsLabel")}
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <RoutineStepsEditor
              steps={steps}
              onChange={setSteps}
              choreCatalog={choreCatalog}
              choreCatalogByTitle={choreCatalogByTitle}
              showNewChoreBadge={false}
            />
          </div>
        </div>
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
            className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800"
          />
        </label>
        <div className="mt-1 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button className="btn btn-secondary" type="button" onClick={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button className="btn btn-primary" type="submit" disabled={saving}>
            {t("common.actions.save")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
