"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";

// Privacy / compliance visibility for support operators. English-only, matching
// the rest of the /support operator console. Surfaces deletion requests and
// recent privacy audit activity (export / consent / child-setting changes)
// without exposing private child detail.

type DeletionFamily = {
  id: string;
  name: string;
  deletionRequestedAt: string;
  deletionScheduledFor: string;
};

type ConsentHealthFamily = {
  id: string;
  name: string;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
  parentalConsentAt: string;
  status: "missing" | "outdated";
};

type RecentConsentEvent = {
  id: string;
  familyId: string;
  userId: string;
  eventType: string;
  documentType: string;
  documentVersion: string;
  acceptedAt: string;
  createdAt: string;
};

type PrivacyEvent = {
  id: string;
  familyId: string;
  eventType: string;
  actorEmail: string;
  actorName: string;
  createdAt: string;
};

type PrivacyPayload = {
  deletionFamilies: DeletionFamily[];
  consentHealthFamilies: ConsentHealthFamily[];
  events: PrivacyEvent[];
  recentConsentEvents: RecentConsentEvent[];
  counts: {
    deletionRequested: number;
    exports: number;
    consents: number;
    consentMissing: number;
    consentOutdated: number;
  };
  currentTermsVersion: string;
  currentPrivacyVersion: string;
};

const EVENT_LABELS: Record<string, string> = {
  privacy_data_export_requested: "Data export",
  privacy_deletion_requested: "Deletion requested",
  privacy_deletion_canceled: "Deletion canceled",
  privacy_consent_recorded: "Consent recorded",
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function SupportPrivacyPanel() {
  const [payload, setPayload] = useState<PrivacyPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/support/privacy", { cache: "no-store" });
      const data = (await response.json()) as PrivacyPayload & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Privacy data unavailable");
      }
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Privacy data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-lg font-bold text-slate-900">Privacy &amp; Compliance</h3>
        <p className="text-sm text-slate-500">
          Deletion requests and recent privacy actions across families.
        </p>
      </div>
      <div className="p-4">
        {error ? <Alert>{error}</Alert> : null}
        {loading ? <div className="family-skeleton family-skeleton-row" /> : null}
        {!loading && payload ? (
          <>
            {payload.currentTermsVersion || payload.currentPrivacyVersion ? (
              <p className="mb-4 text-xs text-slate-500">
                Current required versions &mdash; Terms:{" "}
                <span className="font-mono font-semibold text-slate-700">{payload.currentTermsVersion || "?"}</span>
                {" "}/ Privacy:{" "}
                <span className="font-mono font-semibold text-slate-700">{payload.currentPrivacyVersion || "?"}</span>
              </p>
            ) : null}

            <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
              <SummaryStat label="Deletion Requests" value={payload.counts.deletionRequested} tone="rose" />
              <SummaryStat label="Exports" value={payload.counts.exports} tone="sky" />
              <SummaryStat label="Consents" value={payload.counts.consents} tone="emerald" />
              <SummaryStat label="Missing Consent" value={payload.counts.consentMissing} tone="amber" />
              <SummaryStat label="Outdated Consent" value={payload.counts.consentOutdated} tone="amber" />
            </div>

            <h4 className="mb-2 text-sm font-semibold text-slate-700">Consent Health</h4>
            <div className="mb-5 overflow-auto">
              <table className="w-full min-w-[740px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Accepted Terms</th>
                    <th className="px-3 py-2">Required Terms</th>
                    <th className="px-3 py-2">Accepted Privacy</th>
                    <th className="px-3 py-2">Required Privacy</th>
                    <th className="px-3 py-2">Consent At</th>
                  </tr>
                </thead>
                <tbody>
                  {(payload.consentHealthFamilies ?? []).map((family) => {
                    const termsMatch = family.acceptedTermsVersion === payload.currentTermsVersion;
                    const privacyMatch = family.acceptedPrivacyVersion === payload.currentPrivacyVersion;
                    return (
                      <tr key={family.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{family.name}</div>
                          <div className="text-xs text-slate-500">{family.id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${family.status === "missing" ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>
                            {family.status === "missing" ? "Missing" : "Outdated"}
                          </span>
                        </td>
                        <td className={`px-3 py-2 font-mono text-xs ${termsMatch ? "" : "font-semibold text-amber-700"}`}>
                          {family.acceptedTermsVersion || "-"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{payload.currentTermsVersion || "-"}</td>
                        <td className={`px-3 py-2 font-mono text-xs ${privacyMatch ? "" : "font-semibold text-amber-700"}`}>
                          {family.acceptedPrivacyVersion || "-"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{payload.currentPrivacyVersion || "-"}</td>
                        <td className="px-3 py-2">{formatDate(family.parentalConsentAt)}</td>
                      </tr>
                    );
                  })}
                  {(payload.consentHealthFamilies ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">
                        All families have up-to-date consent.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h4 className="mb-2 text-sm font-semibold text-slate-700">Recent Consent Events</h4>
            <div className="mb-5 overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {(payload.recentConsentEvents ?? []).map((event) => (
                    <tr key={event.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">{event.eventType}</td>
                      <td className="px-3 py-2">{event.documentType}</td>
                      <td className="px-3 py-2 font-mono text-xs">{event.documentVersion || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{event.familyId}</td>
                      <td className="px-3 py-2">{formatDate(event.acceptedAt)}</td>
                    </tr>
                  ))}
                  {(payload.recentConsentEvents ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">
                        No consent events recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h4 className="mb-2 text-sm font-semibold text-slate-700">Families with Deletion Requested</h4>
            <div className="overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">Requested</th>
                    <th className="px-3 py-2">Scheduled For</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.deletionFamilies.map((family) => (
                    <tr key={family.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{family.name}</div>
                        <div className="text-xs text-slate-500">{family.id}</div>
                      </td>
                      <td className="px-3 py-2">{formatDate(family.deletionRequestedAt)}</td>
                      <td className="px-3 py-2">{formatDate(family.deletionScheduledFor)}</td>
                    </tr>
                  ))}
                  {payload.deletionFamilies.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-sm text-slate-500">
                        No families have requested deletion.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Recent Privacy Activity</h4>
            <div className="overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Family</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.events.map((event) => (
                    <tr key={event.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {EVENT_LABELS[event.eventType] ?? event.eventType}
                      </td>
                      <td className="px-3 py-2">{event.actorEmail || event.actorName || "-"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{event.familyId}</td>
                      <td className="px-3 py-2">{formatDate(event.createdAt)}</td>
                    </tr>
                  ))}
                  {payload.events.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-500">
                        No recent privacy activity.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "sky" | "emerald" | "amber";
}) {
  const toneClass = {
    rose: "border-rose-200 bg-rose-50 text-rose-950",
    sky: "border-sky-200 bg-sky-50 text-sky-950",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
  }[tone];
  return (
    <article className={`rounded-2xl border p-3 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </article>
  );
}
