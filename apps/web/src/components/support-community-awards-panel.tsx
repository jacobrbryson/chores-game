"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { FAMILY_REWARD_IMAGE_OPTIONS } from "@/lib/family/rewards";

type SupportCommunityAward = {
  id: string;
  sourceFamilyId: string;
  sourceRewardId: string;
  publicTitle: string;
  publicDescription: string;
  publicCoinAmount: number;
  publicImage: string;
  publicImagePath: string;
  publicCategory: string;
  publicTags: string[];
  status: string;
  rejectionReason: string;
  internalModerationNotes: string;
  voteCount: number;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
};

type SupportCommunityAwardsResponse = {
  awards: SupportCommunityAward[];
  counts: Record<string, number>;
  reports: {
    mostVoted: SupportCommunityAward[];
    mostCopied: SupportCommunityAward[];
    recentSubmissions: SupportCommunityAward[];
  };
};

const STATUSES = ["pending_review", "approved", "rejected", "hidden", "withdrawn"] as const;

function formatDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "-";
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ");
}

export function SupportCommunityAwardsPanel() {
  const [payload, setPayload] = useState<SupportCommunityAwardsResponse | null>(null);
  const [status, setStatus] = useState("pending_review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<SupportCommunityAward | null>(null);
  const [saving, setSaving] = useState(false);

  const awards = useMemo(() => payload?.awards ?? [], [payload]);

  const loadAwards = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/support/community-awards?status=${encodeURIComponent(status)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `SUPPORT_COMMUNITY_AWARDS_HTTP_${response.status}`);
      }
      setPayload((await response.json()) as SupportCommunityAwardsResponse);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "support_community_awards_unavailable");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void loadAwards();
  }, [loadAwards]);

  async function saveAward(action?: "approve" | "reject" | "hide" | "restore") {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/support/community-awards/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          publicTitle: editing.publicTitle,
          publicDescription: editing.publicDescription,
          publicCoinAmount: editing.publicCoinAmount,
          publicImage: editing.publicImage,
          publicCategory: editing.publicCategory,
          publicTags: editing.publicTags,
          rejectionReason: editing.rejectionReason,
          internalModerationNotes: editing.internalModerationNotes,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `SUPPORT_COMMUNITY_AWARD_PATCH_HTTP_${response.status}`);
      }
      setEditing(null);
      await loadAwards();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "support_community_award_update_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Community Awards Review</h2>
          <p className="text-sm text-slate-600">Review, edit, approve, reject, hide, and restore submitted family awards.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((entry) => (
            <Button
              key={entry}
              type="button"
              className={status === entry ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setStatus(entry)}>
              {statusLabel(entry)} ({payload?.counts?.[entry] ?? 0})
            </Button>
          ))}
        </div>
      </div>

      {error ? <Alert className="m-4">{error}</Alert> : null}
      {loading ? <div className="p-4 text-sm text-slate-600">Loading community award submissions...</div> : null}
      {!loading && awards.length === 0 ? (
        <div className="p-4 text-sm text-slate-600">No community award submissions in this status.</div>
      ) : null}
      {!loading && awards.length > 0 ? (
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Award</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Metrics</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {awards.map((award) => (
                <tr key={award.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Image src={award.publicImagePath || "/rewards/screens.png"} alt="" width={56} height={56} className="rounded-md object-cover" />
                      <div>
                        <div className="font-semibold text-slate-900">{award.publicTitle}</div>
                        <div className="text-xs text-slate-500">{award.publicCoinAmount} coins / {award.publicCategory || "family"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{statusLabel(award.status)}</td>
                  <td className="px-3 py-2">{award.voteCount} votes / {award.copyCount} copies</td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-slate-500">{award.sourceFamilyId}</div>
                    <div className="text-xs text-slate-500">{award.sourceRewardId}</div>
                  </td>
                  <td className="px-3 py-2">{formatDate(award.updatedAt || award.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Button type="button" className="btn btn-secondary" onClick={() => setEditing(award)}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {payload ? (
        <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-3">
          <ReportList title="Most voted" rows={payload.reports.mostVoted} metric="voteCount" />
          <ReportList title="Most copied" rows={payload.reports.mostCopied} metric="copyCount" />
          <ReportList title="Recent submissions" rows={payload.reports.recentSubmissions} metric="createdAt" />
        </div>
      ) : null}

      <ModalShell open={Boolean(editing)} onRequestClose={() => setEditing(null)}>
        {editing ? (
          <div className="family-modal-card w-full max-w-3xl">
            <div className="modal-dialog-title-row family-modal-title-row">
              <h3 className="family-modal-title">Review Community Award</h3>
              <Button type="button" className="modal-close-button" onClick={() => setEditing(null)} aria-label="Close">
                X
              </Button>
            </div>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Public title
                <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={editing.publicTitle} onChange={(event) => setEditing({ ...editing, publicTitle: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Public description
                <textarea className="rounded-md border border-slate-300 px-3 py-2 font-normal" rows={4} value={editing.publicDescription} onChange={(event) => setEditing({ ...editing, publicDescription: event.target.value })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Public coin amount
                  <input type="number" min={1} className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={editing.publicCoinAmount} onChange={(event) => setEditing({ ...editing, publicCoinAmount: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Public category
                  <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={editing.publicCategory} onChange={(event) => setEditing({ ...editing, publicCategory: event.target.value })} />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Public image
                <select className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={editing.publicImage} onChange={(event) => setEditing({ ...editing, publicImage: event.target.value })}>
                  {FAMILY_REWARD_IMAGE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Public tags
                <input className="rounded-md border border-slate-300 px-3 py-2 font-normal" value={editing.publicTags.join(", ")} onChange={(event) => setEditing({ ...editing, publicTags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Rejection reason
                <textarea className="rounded-md border border-slate-300 px-3 py-2 font-normal" rows={2} value={editing.rejectionReason} onChange={(event) => setEditing({ ...editing, rejectionReason: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Internal moderation notes
                <textarea className="rounded-md border border-slate-300 px-3 py-2 font-normal" rows={2} value={editing.internalModerationNotes} onChange={(event) => setEditing({ ...editing, internalModerationNotes: event.target.value })} />
              </label>
            </div>
            <div className="family-modal-actions">
              <Button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void saveAward()}>
                Save edits
              </Button>
              <Button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveAward("approve")}>
                Approve
              </Button>
              <Button type="button" className="btn btn-warning" disabled={saving} onClick={() => void saveAward("reject")}>
                Reject
              </Button>
              <Button type="button" className="btn btn-danger" disabled={saving} onClick={() => void saveAward("hide")}>
                Hide
              </Button>
              <Button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void saveAward("restore")}>
                Restore
              </Button>
            </div>
          </div>
        ) : null}
      </ModalShell>
    </section>
  );
}

function ReportList({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: SupportCommunityAward[];
  metric: "voteCount" | "copyCount" | "createdAt";
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="mt-2 grid gap-2 text-sm text-slate-600">
        {rows.length === 0 ? <span>No rows yet.</span> : null}
        {rows.map((row) => (
          <div key={`${title}-${row.id}`} className="flex items-center justify-between gap-3">
            <span className="truncate">{row.publicTitle || row.id}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {metric === "createdAt" ? formatDate(row.createdAt) : row[metric]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
