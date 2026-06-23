"use client";

import { useCallback, useState } from "react";

// Shared approve/reject calls for the Approval Inbox (dashboard card + page).
// All approvals go through the existing PATCH /api/chores/{id} endpoint so there
// is a single source of business-logic truth (apps/web/src/app/api/chores/
// [choreId]/actions/approve.ts & reject.ts). The hook only owns the network
// calls plus shared busy/error state and the wallet-refresh side effect.

export type ApprovalPayout = { assigneeId: string; coinValue: number };

export type ApproveAllResult = {
  succeeded: string[];
  failed: Array<{ choreId: string; error: string }>;
};

function dispatchWalletRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("wallet:refresh"));
  }
}

async function patchChore(choreId: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/chores/${choreId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `CHORE_PATCH_HTTP_${response.status}`);
  }
}

export function useApprovalActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const approveImmediate = useCallback(async (choreId: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await patchChore(choreId, { action: "approve" });
      dispatchWalletRefresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "approve_chore_failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const approveWithPayouts = useCallback(
    async (choreId: string, payouts: ApprovalPayout[]): Promise<boolean> => {
      setBusy(true);
      setError("");
      try {
        await patchChore(choreId, {
          action: "approve",
          approvalPayouts: payouts.map((payout) => ({
            assigneeId: payout.assigneeId,
            coinValue: Math.max(0, Math.trunc(Number(payout.coinValue) || 0)),
          })),
        });
        dispatchWalletRefresh();
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "approve_chore_failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Approve a batch of chores that all have predefined coin values. Runs
  // sequentially so a mid-batch failure never leaves the wallet in a partial
  // state the user can't see — failures are reported back per chore.
  const approveAll = useCallback(async (choreIds: string[]): Promise<ApproveAllResult> => {
    setBusy(true);
    setError("");
    const succeeded: string[] = [];
    const failed: Array<{ choreId: string; error: string }> = [];
    try {
      for (const choreId of choreIds) {
        try {
          await patchChore(choreId, { action: "approve" });
          succeeded.push(choreId);
        } catch (caught) {
          failed.push({
            choreId,
            error: caught instanceof Error ? caught.message : "approve_chore_failed",
          });
        }
      }
      if (succeeded.length > 0) {
        dispatchWalletRefresh();
      }
      if (failed.length > 0) {
        setError(`approve_all_failed_${failed.length}`);
      }
      return { succeeded, failed };
    } finally {
      setBusy(false);
    }
  }, []);

  const reject = useCallback(async (choreId: string, feedback: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await patchChore(choreId, { action: "reject", feedback });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reject_chore_failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    busy,
    error,
    setError,
    approveImmediate,
    approveWithPayouts,
    approveAll,
    reject,
  };
}
