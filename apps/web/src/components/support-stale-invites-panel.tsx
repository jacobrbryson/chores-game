"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";

type StaleInvite = {
  familyId: string;
  memberId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  createdBy: string;
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function SupportStaleInvitesPanel({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
} = {}) {
  const [staleInvites, setStaleInvites] = useState<StaleInvite[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<StaleInvite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/stale-invites", { cache: "no-store" });
      const data = (await response.json()) as { staleInvites?: StaleInvite[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Stale invites data unavailable");
      }
      setStaleInvites(data.staleInvites ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Stale invites data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteInvite(invite: StaleInvite) {
    if (deleting) return;
    setDeleting(invite.memberId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: "familyMember", id: invite.memberId, familyId: invite.familyId }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Delete failed");
      }
      setNotice(`Stale invite for ${invite.email} deleted.`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    if (!loading) onCountChange?.(staleInvites.length);
  }, [loading, staleInvites.length, onCountChange]);

  if (!loading && staleInvites.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-200 bg-amber-50/60 p-4">
        <h3 className="text-lg font-bold text-slate-900">Stale Invite Records</h3>
        <p className="text-sm text-slate-500">
          Invited member records that still exist after the person accepted and joined. Safe to delete.
        </p>
      </div>
      <div className="p-4">
        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {loading ? <div className="family-skeleton family-skeleton-row" /> : null}
        {!loading ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Family ID</th>
                  <th className="px-3 py-2">Invited</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staleInvites.map((invite) => (
                  <tr key={`${invite.familyId}-${invite.memberId}`} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{invite.name || invite.email}</div>
                      <div className="text-xs text-slate-500">{invite.email}</div>
                    </td>
                    <td className="px-3 py-2">{invite.role || "-"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{invite.familyId}</td>
                    <td className="px-3 py-2">{formatDate(invite.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Button
                        className="btn btn-danger"
                        disabled={deleting === invite.memberId}
                        onClick={() => setPendingDelete(invite)}>
                        {deleting === invite.memberId ? "Deleting..." : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {staleInvites.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                      No stale invite records found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <ModalShell open={Boolean(pendingDelete)} onRequestClose={() => setPendingDelete(null)}>
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingDelete ? (
            <>
              <div className="modal-dialog-title-row mb-3">
                <h3 className="text-lg font-bold text-slate-800">Delete stale invite?</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingDelete(null)}
                  aria-label="Close">
                  X
                </Button>
              </div>
              <p className="mb-5 text-sm text-slate-600">
                This will permanently delete the stale invite record for{" "}
                <strong className="text-slate-900">{pendingDelete.email}</strong>. The active member
                record will not be affected.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const invite = pendingDelete;
                    setPendingDelete(null);
                    void deleteInvite(invite);
                  }}>
                  Delete
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </section>
  );
}
