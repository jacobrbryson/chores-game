// Mobile Approval Inbox data layer. Mirrors the web hooks
// (apps/web/src/lib/approvals/use-approval-inbox.ts and use-approval-actions.ts)
// against the /api/v1 proxies. The queue derivation itself is shared — it lives
// in @packages/core/approvals-inbox so both apps group and split identically.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, patchMobileChore } from "@/lib/api";
import type { ApprovalChore, AssigneeDirectoryEntry } from "@packages/core";

type ChoresApiResponse = {
  items?: ApprovalChore[];
  chores?: ApprovalChore[];
  assigneeDirectory?: AssigneeDirectoryEntry[];
  viewerRole?: "admin" | "player";
};

export type ApprovalPayout = { assigneeId: string; coinValue: number };

export type ApproveAllResult = {
  succeeded: string[];
  failed: Array<{ choreId: string; error: string }>;
};

export type MobileApprovalInboxState = {
  chores: ApprovalChore[];
  directory: AssigneeDirectoryEntry[];
  viewerRole: "admin" | "player" | null;
  loading: boolean;
  error: string;
  reload: (options?: { silent?: boolean }) => Promise<void>;
};

// Loads the family's awaiting-approval chores. Web additionally refreshes over
// the family-activity websocket; mobile reloads on demand after each action and
// whenever the screen mounts.
export function useMobileApprovalInbox(): MobileApprovalInboxState {
  const [chores, setChores] = useState<ApprovalChore[]>([]);
  const [directory, setDirectory] = useState<AssigneeDirectoryEntry[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSeqRef = useRef(0);

  const reload = useCallback(async (options?: { silent?: boolean }) => {
    const seq = ++requestSeqRef.current;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const payload = (await apiFetch("/chores?status=needs_approval&limit=100")) as ChoresApiResponse;
      if (seq !== requestSeqRef.current) {
        return;
      }
      const nextChores = Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.chores)
          ? payload.chores
          : [];
      setChores(nextChores);
      setDirectory(Array.isArray(payload.assigneeDirectory) ? payload.assigneeDirectory : []);
      setViewerRole(payload.viewerRole ?? null);
      setError("");
    } catch (caught) {
      if (seq === requestSeqRef.current) {
        setError(caught instanceof Error ? caught.message : "approvals_unavailable");
      }
    } finally {
      if (seq === requestSeqRef.current && !options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { chores, directory, viewerRole, loading, error, reload };
}

// Approve/reject calls. Everything goes through PATCH /api/v1/chores/{id} so the
// single source of business-logic truth stays server-side, exactly as on web.
export function useMobileApprovalActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const approveImmediate = useCallback(async (choreId: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await patchMobileChore(choreId, { action: "approve" });
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
        await patchMobileChore(choreId, {
          action: "approve",
          approvalPayouts: payouts.map((payout) => ({
            assigneeId: payout.assigneeId,
            coinValue: Math.max(0, Math.trunc(Number(payout.coinValue) || 0)),
          })),
        });
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

  // Sequential so a mid-batch failure never leaves the wallet in a partial state
  // the parent can't see — failures come back per chore.
  const approveAll = useCallback(async (choreIds: string[]): Promise<ApproveAllResult> => {
    setBusy(true);
    setError("");
    const succeeded: string[] = [];
    const failed: Array<{ choreId: string; error: string }> = [];
    try {
      for (const choreId of choreIds) {
        try {
          await patchMobileChore(choreId, { action: "approve" });
          succeeded.push(choreId);
        } catch (caught) {
          failed.push({
            choreId,
            error: caught instanceof Error ? caught.message : "approve_chore_failed",
          });
        }
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
      await patchMobileChore(choreId, { action: "reject", feedback });
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reject_chore_failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, approveImmediate, approveWithPayouts, approveAll, reject };
}
