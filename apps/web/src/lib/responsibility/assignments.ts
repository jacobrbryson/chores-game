import {
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  documentIdFromName,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  DEFAULT_CHORE_COIN_VALUE,
  nextRecurringDueDate,
  type ChoreRecurrenceConfig,
  type ChoreRecurrenceType,
  type ChoreRecurrenceUnit,
  type ChoreRecurrenceWeekday,
} from "@/lib/chores/recurrence";
import {
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";
import {
  parseCompletedStepIdsJson,
  type RoutineDefinition,
} from "@/lib/responsibility/routines";

// A RoutineAssignment is one occurrence of a Routine template assigned to one
// player. Assignment steps are materialized as ordinary chore documents (so
// completion, approval, the New Skill Bonus, and Kiosk Mode all behave
// exactly like normal chores); the assignment document tracks which steps are
// done and pays the routine-level rewards when the last one finishes.
//
// Steps are snapshotted at assignment time — editing or deleting the template
// later never rewrites an assignment that is already in flight.
//
// Storage: families/{familyId}/routineAssignments/{assignmentId}
export type RoutineAssignmentStatus = "active" | "completed" | "expired";

export type RoutineAssignmentStep = {
  id: string;
  title: string;
  // 1-based position inside the assignment.
  order: number;
  // The materialized chore document id for this step.
  choreId: string;
  // Coins and approval flag for the step chore, kept here so recurring
  // assignments can respawn identical step chores. Both are inherited from
  // the family's existing chore with the same title at assignment time.
  coinValue: number;
  requireApproval: boolean;
};

export type RoutineAssignment = {
  id: string;
  routineId: string;
  routineName: string;
  pillar: ResponsibilityPillar | "";
  assigneeId: string;
  assigneeName: string;
  assignedBy: string;
  status: RoutineAssignmentStatus;
  requireApproval: boolean;
  steps: RoutineAssignmentStep[];
  completedStepIds: string[];
  // Steps the child (or a parent) chose to skip: something already done, or not
  // actually needed this time. A skipped step satisfies the routine for
  // completion purposes but pays no step coins, and — unlike a completed step —
  // never on its own unlocks the completion bonus (see isAssignmentComplete /
  // hasAnyCompletedStep).
  skippedStepIds: string[];
  // -1 means "use the globally configured default bonus XP".
  completionBonusXp: number;
  completionBonusCoins: number;
  dueDate: string;
  recurrenceType: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  recurrenceDays?: ChoreRecurrenceWeekday[];
  createdAt?: string;
  completedAt?: string;
};

export function parseAssignmentStepsJson(json: string): RoutineAssignmentStep[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is { id: string; title: string; order: number; choreId: string } =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { title?: unknown }).title === "string" &&
          typeof (entry as { order?: unknown }).order === "number" &&
          typeof (entry as { choreId?: unknown }).choreId === "string",
      )
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        order: Math.trunc(entry.order),
        choreId: entry.choreId,
        coinValue:
          typeof (entry as { coinValue?: unknown }).coinValue === "number"
            ? Math.max(0, Math.trunc((entry as { coinValue?: number }).coinValue ?? 0))
            : 0,
        requireApproval: (entry as { requireApproval?: unknown }).requireApproval === true,
      }))
      .sort((a, b) => a.order - b.order);
  } catch {
    return [];
  }
}

export function routineAssignmentFromDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): RoutineAssignment {
  const completionBonusXpRaw =
    doc.fields && "completionBonusXp" in doc.fields
      ? readInteger(doc.fields, "completionBonusXp")
      : -1;
  const recurrenceType = readString(doc.fields, "recurrenceType") as ChoreRecurrenceType | "";
  return {
    id: documentIdFromName(doc.name),
    routineId: readString(doc.fields, "routineId"),
    routineName: readString(doc.fields, "routineName") || "Untitled routine",
    pillar: normalizeResponsibilityPillar(readString(doc.fields, "pillar")),
    assigneeId: readString(doc.fields, "assigneeId"),
    assigneeName: readString(doc.fields, "assigneeName"),
    assignedBy: readString(doc.fields, "assignedBy"),
    status:
      readString(doc.fields, "status") === "completed"
        ? "completed"
        : readString(doc.fields, "status") === "expired"
          ? "expired"
          : "active",
    requireApproval: readBoolean(doc.fields, "requireApproval"),
    steps: parseAssignmentStepsJson(readString(doc.fields, "stepsJson")),
    completedStepIds: parseCompletedStepIdsJson(readString(doc.fields, "completedStepIdsJson")),
    skippedStepIds: parseCompletedStepIdsJson(readString(doc.fields, "skippedStepIdsJson")),
    completionBonusXp: completionBonusXpRaw >= 0 ? completionBonusXpRaw : -1,
    completionBonusCoins: Math.max(0, readInteger(doc.fields, "completionBonusCoins")),
    dueDate: readString(doc.fields, "dueDate"),
    recurrenceType: recurrenceType || "none",
    recurrenceInterval: readInteger(doc.fields, "recurrenceInterval") || undefined,
    recurrenceUnit:
      (readString(doc.fields, "recurrenceUnit") as ChoreRecurrenceUnit | "") || undefined,
    recurrenceDays: readStringArray(doc.fields, "recurrenceDays") as ChoreRecurrenceWeekday[],
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
    completedAt: readTimestamp(doc.fields, "completedAt") || undefined,
  };
}

// A routine is finished once every step is resolved — each step either
// completed or skipped. A purely-skipped routine still counts as complete here
// (the umbrella record closes out), but earns no completion bonus; that is
// gated separately on hasAnyCompletedStep.
export function isAssignmentComplete(assignment: RoutineAssignment): boolean {
  const resolved = new Set([...assignment.completedStepIds, ...assignment.skippedStepIds]);
  return (
    assignment.steps.length > 0 && assignment.steps.every((step) => resolved.has(step.id))
  );
}

// True when at least one step was actually completed (not merely skipped). The
// routine completion bonus only pays out when this holds.
export function hasAnyCompletedStep(assignment: RoutineAssignment): boolean {
  const completed = new Set(assignment.completedStepIds);
  return assignment.steps.some((step) => completed.has(step.id));
}

export function nextIncompleteStep(
  assignment: RoutineAssignment,
): RoutineAssignmentStep | null {
  const resolved = new Set([...assignment.completedStepIds, ...assignment.skippedStepIds]);
  return assignment.steps.find((step) => !resolved.has(step.id)) ?? null;
}

// Returns the most recent scheduled occurrence on or before `today`. An
// active recurring routine is rolled over only after its original due date,
// so today's work remains available for the whole local calendar day.
export function overdueRoutineRolloverDueDate(
  assignment: Pick<
    RoutineAssignment,
    | "status"
    | "dueDate"
    | "recurrenceType"
    | "recurrenceInterval"
    | "recurrenceUnit"
    | "recurrenceDays"
  >,
  today: string,
): string | null {
  if (
    assignment.status !== "active" ||
    assignment.recurrenceType === "none" ||
    assignment.recurrenceType === "instant" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(assignment.dueDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    assignment.dueDate >= today
  ) {
    return null;
  }

  const recurrence: ChoreRecurrenceConfig = {
    recurrenceType: assignment.recurrenceType,
    recurrenceInterval: assignment.recurrenceInterval,
    recurrenceUnit: assignment.recurrenceUnit,
    recurrenceDays: assignment.recurrenceDays,
  };
  let occurrenceDueDate = assignment.dueDate;
  // The cap is defensive against malformed recurrence data. Normal configs
  // advance on every iteration and reach today's date quickly.
  for (let index = 0; index < 5000; index += 1) {
    const nextDueDate = nextRecurringDueDate(occurrenceDueDate, recurrence, today);
    if (!nextDueDate || nextDueDate <= occurrenceDueDate || nextDueDate > today) {
      break;
    }
    occurrenceDueDate = nextDueDate;
  }
  return occurrenceDueDate === assignment.dueDate ? null : occurrenceDueDate;
}

export function shouldArchiveRoutineStepOnRollover(status: string, deleted: boolean): boolean {
  if (deleted) {
    return false;
  }
  return status === "Open" || status === "Skipped" || status === "";
}

// Resolves the definition for the next recurring occurrence without mutating
// the current assignment snapshot. Retained step ids preserve their existing
// chore settings unless the latest template explicitly overrides them.
export function resolveNextRecurringOccurrence(
  assignment: RoutineAssignment,
  template: Pick<
    RoutineDefinition,
    | "id"
    | "name"
    | "pillar"
    | "steps"
    | "completionBonusXp"
    | "completionBonusCoins"
  > | null,
) {
  if (!template || template.steps.length === 0) {
    return {
      routine: {
        id: assignment.routineId,
        name: assignment.routineName,
        pillar: assignment.pillar,
        completionBonusXp: assignment.completionBonusXp,
        completionBonusCoins: assignment.completionBonusCoins,
      },
      steps: assignment.steps.map((step) => ({
        id: step.id,
        title: step.title,
        coinValue: step.coinValue,
        requireApproval: step.requireApproval,
      })),
    };
  }

  const priorStepsById = new Map(assignment.steps.map((step) => [step.id, step] as const));
  return {
    routine: {
      id: template.id,
      name: template.name,
      pillar: template.pillar,
      completionBonusXp: template.completionBonusXp,
      completionBonusCoins: template.completionBonusCoins,
    },
    steps: template.steps.map((step) => {
      const prior = priorStepsById.get(step.id);
      return {
        id: step.id,
        title: step.title,
        coinValue: step.coinValue ?? prior?.coinValue ?? DEFAULT_CHORE_COIN_VALUE,
        requireApproval: step.requireApproval ?? prior?.requireApproval ?? false,
      };
    }),
  };
}
