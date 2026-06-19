import { applyWalletDelta } from "@/lib/economy/wallet";
import { resolveAssigneeUid } from "@/lib/chores/assignees";

export type ApprovalPayoutEntry = {
  assigneeId: string;
  coinValue: number;
};

export function parseApprovalPayoutsJson(value: string): ApprovalPayoutEntry[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized: ApprovalPayoutEntry[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const assigneeId =
        "assigneeId" in entry && typeof entry.assigneeId === "string"
          ? entry.assigneeId.trim()
          : "";
      const coinValue =
        "coinValue" in entry &&
        typeof entry.coinValue === "number" &&
        Number.isFinite(entry.coinValue)
          ? Math.max(0, Math.trunc(entry.coinValue))
          : -1;
      if (assigneeId && coinValue >= 0) {
        normalized.push({ assigneeId, coinValue });
      }
    }
    return normalized;
  } catch {
    return [];
  }
}

// Builds the per-assignee coin payout for a chore completion/approval. A stored
// payout snapshot (from a prior approval) wins; otherwise coins are split evenly
// across assignees with optional per-assignee overrides from the request.
export function buildPayoutByAssignee(params: {
  assigneeIds: string[];
  totalCoinValue: number;
  storedPayoutsJson?: string;
  overrides?: unknown;
}) {
  const { assigneeIds, totalCoinValue, storedPayoutsJson = "", overrides } = params;
  const payoutByAssignee = new Map<string, number>();
  const storedPayouts = parseApprovalPayoutsJson(storedPayoutsJson);
  if (storedPayouts.length > 0) {
    for (const payout of storedPayouts) {
      payoutByAssignee.set(payout.assigneeId, payout.coinValue);
    }
    return payoutByAssignee;
  }

  const defaultSplit =
    assigneeIds.length > 0 ? Math.ceil(totalCoinValue / assigneeIds.length) : totalCoinValue;
  const overrideByAssignee = new Map<string, number>();
  if (Array.isArray(overrides)) {
    for (const entry of overrides) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const maybeId =
        "assigneeId" in entry && typeof entry.assigneeId === "string"
          ? entry.assigneeId.trim()
          : "";
      const maybeCoin =
        "coinValue" in entry &&
        typeof entry.coinValue === "number" &&
        Number.isFinite(entry.coinValue)
          ? Math.max(0, Math.trunc(entry.coinValue))
          : -1;
      if (maybeId && maybeCoin >= 0) {
        overrideByAssignee.set(maybeId, maybeCoin);
      }
    }
  }
  for (const assigneeId of assigneeIds) {
    payoutByAssignee.set(assigneeId, overrideByAssignee.get(assigneeId) ?? defaultSplit);
  }
  return payoutByAssignee;
}

export type ApplyPayoutResult =
  | { kind: "ok"; anyApplied: boolean }
  | { kind: "wallet_negative_blocked" }
  | { kind: "wallet_permission_denied" };

// Credits or debits each assignee's wallet for a chore transition. Missing
// members (404) are skipped; a blocked negative balance or permission denial
// short-circuits and is surfaced to the caller.
export async function applyPayoutByAssignee(params: {
  familyId: string;
  idToken: string;
  choreId: string;
  payoutByAssignee: Map<string, number>;
  direction: "credit" | "debit";
  actorUid?: string;
  actorRole?: "admin" | "player";
  choreStatus?: string;
}): Promise<ApplyPayoutResult> {
  const {
    familyId,
    idToken,
    choreId,
    payoutByAssignee,
    direction,
    actorUid = "",
    actorRole = "player",
    choreStatus = "",
  } = params;
  console.log("[PAYOUT_BY_ASSIGNEE_ATTEMPT]", {
    familyId,
    choreId,
    direction,
    actorUid,
    actorRole,
    choreStatus,
    payoutEntries: Array.from(payoutByAssignee.entries()),
  });
  let anyApplied = false;
  for (const [assigneeAlias, coins] of payoutByAssignee.entries()) {
    if (coins <= 0) {
      continue;
    }
    const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    console.log("[PAYOUT_BY_ASSIGNEE_RESOLVE]", {
      familyId,
      choreId,
      direction,
      assigneeAlias,
      assigneeUid: assigneeUid || "",
      coins,
    });
    if (!assigneeUid) {
      continue;
    }
    try {
      await applyWalletDelta({
        uid: assigneeUid,
        idToken,
        delta: direction === "credit" ? coins : -coins,
        reason: direction === "credit" ? "chore_complete" : "chore_undo_complete",
        choreId,
        debugMeta: {
          familyId,
          actorUid,
          actorRole,
          choreStatus,
          assigneeAlias,
          assigneeUid,
          direction,
          coins,
        },
      });
      anyApplied = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      console.error("[PAYOUT_BY_ASSIGNEE_ERROR]", {
        familyId,
        choreId,
        direction,
        actorUid,
        actorRole,
        choreStatus,
        assigneeAlias,
        assigneeUid,
        coins,
        reason: reason.slice(0, 220),
      });
      if (direction === "debit" && reason.includes("WALLET_NEGATIVE_BLOCKED")) {
        return { kind: "wallet_negative_blocked" as const };
      }
      if (reason.includes("FIRESTORE_HTTP_403")) {
        return { kind: "wallet_permission_denied" as const };
      }
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }
  return { kind: "ok" as const, anyApplied };
}
