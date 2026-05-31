export type ApprovalAssigneeSelection = {
  enabled: boolean;
  coinValue: number;
};

export type ApprovalAssigneeSelectionMap = Record<string, ApprovalAssigneeSelection>;

function normalizeWholeNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function uniqueAssigneeIds(assigneeIds: string[]) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const assigneeId of assigneeIds) {
    const normalized = assigneeId.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function distributeCoins(totalCoins: number, assigneeIds: string[]) {
  const normalizedTotalCoins = normalizeWholeNumber(totalCoins);
  if (assigneeIds.length === 0) {
    return {} as Record<string, number>;
  }
  const baseAmount = Math.floor(normalizedTotalCoins / assigneeIds.length);
  const remainder = normalizedTotalCoins % assigneeIds.length;
  return assigneeIds.reduce<Record<string, number>>((result, assigneeId, index) => {
    result[assigneeId] = baseAmount + (index < remainder ? 1 : 0);
    return result;
  }, {});
}

export function createApprovalAssigneeSelections(
  assigneeIds: string[],
  totalCoins: number,
): ApprovalAssigneeSelectionMap {
  const orderedAssigneeIds = uniqueAssigneeIds(assigneeIds);
  const payouts = distributeCoins(totalCoins, orderedAssigneeIds);
  return orderedAssigneeIds.reduce<ApprovalAssigneeSelectionMap>((result, assigneeId) => {
    result[assigneeId] = {
      enabled: true,
      coinValue: payouts[assigneeId] ?? 0,
    };
    return result;
  }, {});
}

export function toggleApprovalAssigneeSelection(
  selections: ApprovalAssigneeSelectionMap,
  assigneeIds: string[],
  assigneeId: string,
  totalCoins: number,
): ApprovalAssigneeSelectionMap {
  const orderedAssigneeIds = uniqueAssigneeIds(assigneeIds);
  const normalizedAssigneeId = assigneeId.trim();
  const enabledAssigneeIds = orderedAssigneeIds.filter((candidateId) => {
    if (candidateId === normalizedAssigneeId) {
      return !(selections[candidateId]?.enabled ?? true);
    }
    return selections[candidateId]?.enabled !== false;
  });
  const payouts = distributeCoins(totalCoins, enabledAssigneeIds);
  return orderedAssigneeIds.reduce<ApprovalAssigneeSelectionMap>((result, candidateId) => {
    const enabled = enabledAssigneeIds.includes(candidateId);
    result[candidateId] = {
      enabled,
      coinValue: enabled ? payouts[candidateId] ?? 0 : 0,
    };
    return result;
  }, {});
}

export function updateApprovalAssigneeCoins(
  selections: ApprovalAssigneeSelectionMap,
  assigneeId: string,
  coinValue: number,
): ApprovalAssigneeSelectionMap {
  const normalizedAssigneeId = assigneeId.trim();
  const current = selections[normalizedAssigneeId];
  return {
    ...selections,
    [normalizedAssigneeId]: {
      enabled: current?.enabled !== false,
      coinValue: current?.enabled === false ? 0 : normalizeWholeNumber(coinValue),
    },
  };
}

export function listApprovalPayouts(
  selections: ApprovalAssigneeSelectionMap,
  assigneeIds: string[],
) {
  return uniqueAssigneeIds(assigneeIds).map((assigneeId) => ({
    assigneeId,
    coinValue:
      selections[assigneeId]?.enabled === false
        ? 0
        : normalizeWholeNumber(selections[assigneeId]?.coinValue ?? 0),
  }));
}
