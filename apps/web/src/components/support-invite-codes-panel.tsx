"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";

type SupportInvite = {
  id: string;
  familyId: string;
  familyName: string;
  invitedName: string;
  invitedEmail: string;
  privateRelayEmail: boolean;
  role: string;
  status: string;
  redeemable: boolean;
  blockedReason: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string;
  acceptedByUid: string;
};

type Summary = {
  total: number;
  redeemable: number;
  accepted: number;
  expired: number;
  locked: number;
};

const BLOCKED_LABELS: Record<string, string> = {
  invite_already_used: "Already used",
  invite_revoked: "Revoked",
  invite_expired: "Expired",
  invite_locked: "Locked (too many attempts)",
  invite_not_found: "Missing",
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Operator visibility into family invite tokens. Codes themselves are stored
 * only as hashes and are never shown here — this panel answers "is their invite
 * still good?", which is the question support actually gets asked.
 */
export function SupportInviteCodesPanel() {
  const [invites, setInvites] = useState<SupportInvite[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/invite-codes", { cache: "no-store" });
      const data = (await response.json()) as {
        invites?: SupportInvite[];
        summary?: Summary;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Invite code data unavailable");
      }
      setInvites(data.invites ?? []);
      setSummary(data.summary ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Invite code data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50/60 p-4">
        <h3 className="text-lg font-bold text-slate-900">Family Invite Codes</h3>
        <p className="text-sm text-slate-500">
          Single-use join codes issued with each invitation. Codes are stored hashed and are never
          shown here — a parent re-invites to mint a new one.
        </p>
        {summary ? (
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
            <span>Total: {summary.total}</span>
            <span>Redeemable: {summary.redeemable}</span>
            <span>Accepted: {summary.accepted}</span>
            <span>Expired: {summary.expired}</span>
            <span>Locked: {summary.locked}</span>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {error ? <Alert>{error}</Alert> : null}
        {loading ? <div className="family-skeleton family-skeleton-row" /> : null}
        {!loading && !error ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Invitee</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">
                        {invite.invitedName || "(no name)"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {invite.invitedEmail || "no family-visible email"}
                        {invite.privateRelayEmail ? " · joined via Apple private relay" : ""}
                      </div>
                      <div className="text-xs text-slate-400">{invite.role}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      <div>{invite.familyName || "-"}</div>
                      <div className="text-slate-400">{invite.familyId}</div>
                    </td>
                    <td className="px-3 py-2">
                      {invite.redeemable ? (
                        <span className="font-semibold text-emerald-700">Redeemable</span>
                      ) : (
                        <span className="text-slate-600">
                          {BLOCKED_LABELS[invite.blockedReason] ?? invite.status}
                        </span>
                      )}
                      {invite.acceptedAt ? (
                        <div className="text-xs text-slate-400">
                          by {invite.acceptedByUid || "-"} at {formatDate(invite.acceptedAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {invite.attemptCount}/{invite.maxAttempts}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDate(invite.createdAt)}</td>
                    <td className="px-3 py-2 text-xs">{formatDate(invite.expiresAt)}</td>
                  </tr>
                ))}
                {invites.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                      No invite codes issued yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
