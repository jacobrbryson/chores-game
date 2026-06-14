// Mobile copy of the web helper (apps/web/src/lib/responsibility/routine-chores.ts).
// A routine assignment materializes one chore per step; lists should surface
// only the next actionable step so a 6-step routine doesn't flood the list.

export type RoutineChoreRow = {
  id: string;
  status: string;
  routineAssignmentId?: string;
  routineId?: string;
  routineName?: string;
  routineStepOrder?: number;
  routineStepCount?: number;
};

export function isRoutineChore(row: RoutineChoreRow): boolean {
  return Boolean(row.routineAssignmentId);
}

// Keeps every non-routine row untouched. For routine rows, keeps rows that are
// submitted or finished and only the lowest-step-order open row per assignment
// (the "next step"). Relative order of the surviving rows is preserved.
export function collapseRoutineChores<T extends RoutineChoreRow>(rows: T[]): T[] {
  const nextOpenStepByAssignment = new Map<string, T>();
  for (const row of rows) {
    if (!row.routineAssignmentId || row.status !== "Open") {
      continue;
    }
    const current = nextOpenStepByAssignment.get(row.routineAssignmentId);
    if (
      !current ||
      (row.routineStepOrder ?? Number.MAX_SAFE_INTEGER) <
        (current.routineStepOrder ?? Number.MAX_SAFE_INTEGER)
    ) {
      nextOpenStepByAssignment.set(row.routineAssignmentId, row);
    }
  }
  return rows.filter((row) => {
    if (!row.routineAssignmentId || row.status !== "Open") {
      return true;
    }
    return nextOpenStepByAssignment.get(row.routineAssignmentId)?.id === row.id;
  });
}
