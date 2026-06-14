type ChoreCoinAssignmentState = {
  choreType?: string;
  coinValue?: number | null;
  status?: string;
  assigneeScope?: "single" | "multiple" | "family" | string | null;
  assigneeIds?: string[] | null;
};

function normalizeCoinValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function choreHasAssignedCoinValue(chore: ChoreCoinAssignmentState) {
  return normalizeCoinValue(chore.coinValue) > 0;
}

export function choreNeedsCoinAssignmentPrompt(chore: ChoreCoinAssignmentState) {
  const isMultiOrFamily =
    chore.assigneeScope === "family" || (chore.assigneeIds?.length ?? 0) > 1;
  if (isMultiOrFamily) {
    return true;
  }
  if (chore.choreType !== "see_and_do") {
    return false;
  }
  return !choreHasAssignedCoinValue(chore);
}

export function shouldHideChoreCoinValue(chore: ChoreCoinAssignmentState) {
  return (
    chore.choreType === "see_and_do" &&
    chore.status !== "Approved" &&
    !choreHasAssignedCoinValue(chore)
  );
}
