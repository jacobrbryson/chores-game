"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type SummaryPayload = {
  weekStartDateOnly: string;
  sentThisWeek: number;
  failedThisWeek: number;
  skippedThisWeek: number;
  optedOutRecipients: number;
  familiesWithNewsletterActivity: number;
  skippedReasons: Record<string, number>;
  recentFailures: Array<{
    id: string;
    familyId: string;
    recipientEmail: string;
    errorMessage: string;
    updatedAt: string;
  }>;
  recentRecords: Array<{
    id: string;
    familyId: string;
    recipientEmail: string;
    status: string;
    skippedReason: string;
    provider: string;
    updatedAt: string;
  }>;
};

type PreviewPayload = {
  family: {
    familyName: string;
    recipients: Array<{ uid: string; email: string; optedIn: boolean }>;
  };
  metrics: {
    choresCompleted: number;
    coinsEarned: number;
    rewardsRedeemed: number;
    familyAwardsClaimed: number;
    questsCompleted: number;
    achievementsUnlocked: number;
    pendingApprovals: number;
    hasActivity: boolean;
  };
  rendered: {
    subject: string;
    html: string;
    text: string;
  };
};

function formatDate(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function SupportNewslettersPanel() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [testSendPending, setTestSendPending] = useState(false);
  const [testSendResult, setTestSendResult] = useState("");

  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const response = await fetch("/api/support/newsletters/weekly/summary", { cache: "no-store" });
      const payload = (await response.json()) as SummaryPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `SUPPORT_NEWSLETTER_SUMMARY_HTTP_${response.status}`);
      }
      setSummary(payload);
    } catch (errorValue) {
      setSummaryError(errorValue instanceof Error ? errorValue.message : "weekly_newsletter_summary_unavailable");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  async function onLoadPreview() {
    if (!familyId.trim()) {
      setPreviewError("Enter a family ID to load a preview.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    setTestSendResult("");
    try {
      const response = await fetch(
        `/api/support/newsletters/weekly/preview?familyId=${encodeURIComponent(familyId.trim())}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as PreviewPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `SUPPORT_NEWSLETTER_PREVIEW_HTTP_${response.status}`);
      }
      setPreview(payload);
    } catch (errorValue) {
      setPreview(null);
      setPreviewError(errorValue instanceof Error ? errorValue.message : "weekly_newsletter_preview_unavailable");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onTestSend() {
    if (!familyId.trim()) {
      setPreviewError("Enter a family ID before sending a test email.");
      return;
    }
    setTestSendPending(true);
    setPreviewError("");
    setTestSendResult("");
    try {
      const response = await fetch("/api/support/newsletters/weekly/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: familyId.trim() }),
      });
      const payload = (await response.json()) as { error?: string; recipientEmail?: string; providerMessageId?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `SUPPORT_NEWSLETTER_TEST_SEND_HTTP_${response.status}`);
      }
      setTestSendResult(`Sent test newsletter to ${payload.recipientEmail} (${payload.providerMessageId}).`);
      await loadSummary();
    } catch (errorValue) {
      setPreviewError(errorValue instanceof Error ? errorValue.message : "weekly_newsletter_test_send_failed");
    } finally {
      setTestSendPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Weekly Newsletters</h2>
          <p className="mt-1 text-sm text-slate-600">
            Preview weekly family highlights, send a support-only test email, and inspect recent send outcomes.
          </p>
        </div>
        <Button className="btn btn-secondary" disabled={summaryLoading} onClick={() => void loadSummary()}>
          Refresh
        </Button>
      </div>

      {summaryError ? <Alert className="mt-4">{summaryError}</Alert> : null}

      {summary ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Sent this week</div><div className="mt-1 text-2xl font-bold">{summary.sentThisWeek}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Failed this week</div><div className="mt-1 text-2xl font-bold">{summary.failedThisWeek}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Skipped this week</div><div className="mt-1 text-2xl font-bold">{summary.skippedThisWeek}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Opted out</div><div className="mt-1 text-2xl font-bold">{summary.optedOutRecipients}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Families with activity</div><div className="mt-1 text-2xl font-bold">{summary.familiesWithNewsletterActivity}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Week start</div><div className="mt-1 text-lg font-bold">{summary.weekStartDateOnly}</div></div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-base font-bold text-slate-900">Preview / Test Send</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={familyId}
              onChange={(event) => setFamilyId(event.target.value)}
              placeholder="Family ID"
              className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <Button className="btn btn-primary" disabled={previewLoading} onClick={() => void onLoadPreview()}>
              {previewLoading ? "Loading..." : "Load Preview"}
            </Button>
            <Button className="btn btn-secondary" disabled={testSendPending} onClick={() => void onTestSend()}>
              {testSendPending ? "Sending..." : "Send Test to Me"}
            </Button>
          </div>
          {previewError ? <Alert className="mt-3">{previewError}</Alert> : null}
          {testSendResult ? <p className="mt-3 text-sm text-emerald-700">{testSendResult}</p> : null}
          {preview ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div><strong>Family:</strong> {preview.family.familyName}</div>
                <div><strong>Subject:</strong> {preview.rendered.subject}</div>
                <div><strong>Recipients:</strong> {preview.family.recipients.length}</div>
                <div><strong>Activity:</strong> {preview.metrics.hasActivity ? "Yes" : "No"}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
                <div>Chores completed: <strong>{preview.metrics.choresCompleted}</strong></div>
                <div>Coins earned: <strong>{preview.metrics.coinsEarned}</strong></div>
                <div>Rewards redeemed: <strong>{preview.metrics.rewardsRedeemed}</strong></div>
                <div>Pending approvals: <strong>{preview.metrics.pendingApprovals}</strong></div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Rendered HTML preview</div>
                <div className="max-h-[28rem] overflow-auto p-3" dangerouslySetInnerHTML={{ __html: preview.rendered.html }} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-base font-bold text-slate-900">Recent failures</h3>
            <div className="mt-3 space-y-2 text-sm">
              {summary?.recentFailures.length ? summary.recentFailures.map((failure) => (
                <div key={failure.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <div className="font-semibold text-rose-900">{failure.familyId} · {failure.recipientEmail}</div>
                  <div className="mt-1 text-rose-700">{failure.errorMessage || "Unknown provider failure"}</div>
                  <div className="mt-1 text-xs text-rose-600">{formatDate(failure.updatedAt)}</div>
                </div>
              )) : <p className="text-slate-500">No recent failures.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-base font-bold text-slate-900">Recent send records</h3>
            <div className="mt-3 space-y-2 text-sm">
              {summary?.recentRecords.length ? summary.recentRecords.map((record) => (
                <div key={record.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="font-semibold text-slate-900">{record.familyId} · {record.recipientEmail}</div>
                  <div className="mt-1 text-slate-700">
                    {record.status}
                    {record.skippedReason ? ` (${record.skippedReason})` : ""}
                    {record.provider ? ` · ${record.provider}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatDate(record.updatedAt)}</div>
                </div>
              )) : <p className="text-slate-500">No send records yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
