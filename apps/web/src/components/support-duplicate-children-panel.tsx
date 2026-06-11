"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";

type ChildActivity = {
  choreCount: number;
  completedChoreCount: number;
  coinBalance: number;
  walletEntryCount: number;
  inventoryCount: number;
  achievementCount: number;
};

type DuplicateChildCandidate = {
  familyId: string;
  memberId: string;
  name: string;
  createdAt: string;
  isOriginal: boolean;
  hasMeaningfulActivity: boolean;
  safeToDelete: boolean;
  createdAfterFamilyConsent: boolean;
  activity: ChildActivity;
};

type DuplicateChildGroup = {
  familyId: string;
  displayName: string;
  candidates: DuplicateChildCandidate[];
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function activitySummary(activity: ChildActivity) {
  const parts: string[] = [];
  if (activity.choreCount) parts.push(`${activity.choreCount} chores`);
  if (activity.completedChoreCount) parts.push(`${activity.completedChoreCount} completed`);
  if (activity.coinBalance) parts.push(`${activity.coinBalance} coins`);
  if (activity.walletEntryCount) parts.push(`${activity.walletEntryCount} ledger`);
  if (activity.inventoryCount) parts.push(`${activity.inventoryCount} items`);
  if (activity.achievementCount) parts.push(`${activity.achievementCount} achievements`);
  return parts.length ? parts.join(", ") : "none";
}

export function SupportDuplicateChildrenPanel() {
  const [groups, setGroups] = useState<DuplicateChildGroup[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DuplicateChildCandidate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/duplicate-children", { cache: "no-store" });
      const data = (await response.json()) as { groups?: DuplicateChildGroup[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Duplicate children data unavailable");
      }
      setGroups(data.groups ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Duplicate children data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function softDelete(candidate: DuplicateChildCandidate) {
    if (deleting) return;
    setDeleting(candidate.memberId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/duplicate-children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: candidate.familyId, memberId: candidate.memberId }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || data.message || "Soft-delete failed");
      }
      setNotice(`Soft-deleted duplicate "${candidate.name}".`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Soft-delete failed");
    } finally {
      setDeleting(null);
    }
  }

  const totalDuplicates = groups.reduce(
    (sum, group) => sum + group.candidates.filter((c) => !c.isOriginal).length,
    0,
  );

  return (
    <section className="rounded-2xl border border-rose-200 bg-white shadow-sm">
      <div className="border-b border-rose-200 bg-rose-50/60 p-4">
        <h3 className="text-lg font-bold text-slate-900">Duplicate Children</h3>
        <p className="text-sm text-slate-500">
          Possible duplicate child profiles (same family + same name). Only empty, non-original
          duplicates can be soft-deleted. Children with chores, coins, inventory, or achievements are
          never deletable here.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-600">
            {groups.length} group(s), {totalDuplicates} duplicate(s)
          </span>
          <Button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>
      <div className="p-4">
        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {loading ? <div className="family-skeleton family-skeleton-row" /> : null}
        {!loading && groups.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500">
            No duplicate children detected.
          </p>
        ) : null}
        {!loading
          ? groups.map((group) => (
              <div
                key={`${group.familyId}-${group.displayName}`}
                className="mb-4 overflow-auto rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-baseline gap-2 bg-slate-50 px-3 py-2">
                  <span className="font-semibold text-slate-900">{group.displayName}</span>
                  <span className="text-xs text-slate-500">family {group.familyId}</span>
                </div>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Member ID</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Activity</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.candidates.map((candidate) => (
                      <tr key={candidate.memberId} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 text-xs text-slate-500">{candidate.memberId}</td>
                        <td className="px-3 py-2">
                          {formatDate(candidate.createdAt)}
                          {candidate.createdAfterFamilyConsent ? (
                            <div className="text-xs text-amber-600">after TOS acceptance</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{activitySummary(candidate.activity)}</td>
                        <td className="px-3 py-2">
                          {candidate.isOriginal ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              original (keep)
                            </span>
                          ) : candidate.safeToDelete ? (
                            <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                              empty duplicate
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              has activity
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {candidate.safeToDelete ? (
                            <Button
                              className="btn btn-danger"
                              disabled={deleting === candidate.memberId}
                              onClick={() => setPendingDelete(candidate)}>
                              {deleting === candidate.memberId ? "Deleting..." : "Soft-delete"}
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          : null}
      </div>
      <ModalShell open={Boolean(pendingDelete)} onRequestClose={() => setPendingDelete(null)}>
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingDelete ? (
            <>
              <div className="modal-dialog-title-row mb-3">
                <h3 className="text-lg font-bold text-slate-800">Soft-delete duplicate child?</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingDelete(null)}
                  aria-label="Close">
                  X
                </Button>
              </div>
              <p className="mb-5 text-sm text-slate-600">
                This marks the empty duplicate{" "}
                <strong className="text-slate-900">{pendingDelete.name}</strong> ({pendingDelete.memberId})
                as deleted. It is a soft-delete — the record is retained and the server re-checks for
                activity before deleting.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const candidate = pendingDelete;
                    setPendingDelete(null);
                    void softDelete(candidate);
                  }}>
                  Soft-delete
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </section>
  );
}
