import {
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  documentIdFromName,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import type { ChoreRecurrenceType, ChoreRecurrenceUnit } from "@/lib/chores/recurrence";
import {
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";
import { parseCompletedStepIdsJson } from "@/lib/responsibility/routines";

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
export type RoutineAssignmentStatus = "active" | "completed";

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
    status: readString(doc.fields, "status") === "completed" ? "completed" : "active",
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
