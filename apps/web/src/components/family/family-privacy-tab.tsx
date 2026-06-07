"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import { useLocale } from "@/components/locale-provider";
import { SUPPORTED_DATA_REGIONS } from "@/lib/privacy/config";
import type { ConsentEvent, PrivacyResponse } from "@/lib/privacy/types";

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatDate(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export function FamilyPrivacyTab() {
  const { t } = useLocale();
  const [data, setData] = useState<PrivacyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [region, setRegion] = useState<string>("US");
  const [pendingDeletion, setPendingDeletion] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/family/privacy", { cache: "no-store" });
      const payload = (await response.json()) as PrivacyResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `PRIVACY_HTTP_${response.status}`);
      }
      setData(payload);
      setRegion(payload.overview.dataRegion || "US");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "privacy_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function recordConsent() {
    setBusy("consent");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/family/privacy/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataRegion: region }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `CONSENT_HTTP_${response.status}`);
      }
      setNotice(t("family.privacy.consentRecorded"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "record_consent_failed");
    } finally {
      setBusy("");
    }
  }

  async function downloadExport() {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/family/privacy/export", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `EXPORT_HTTP_${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      link.download = match?.[1] ?? "family-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(t("family.privacy.exportStarted"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "export_failed");
    } finally {
      setBusy("");
    }
  }

  async function requestDeletion() {
    setPendingDeletion(false);
    setBusy("deletion");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/family/privacy/deletion", { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `DELETION_HTTP_${response.status}`);
      }
      setNotice(t("family.privacy.deletionScheduledNotice"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "request_deletion_failed");
    } finally {
      setBusy("");
    }
  }

  async function cancelDeletion() {
    setBusy("deletion");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/family/privacy/deletion", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `DELETION_CANCEL_HTTP_${response.status}`);
      }
      setNotice(t("family.privacy.deletionCanceledNotice"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "cancel_deletion_failed");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="family-page-grid" aria-hidden="true">
        <div className="family-skeleton family-skeleton-reward" />
        <div className="family-skeleton family-skeleton-reward" />
      </div>
    );
  }

  if (error && !data) {
    return <Alert>{t("family.privacy.loadError", { error })}</Alert>;
  }

  if (!data) {
    return null;
  }

  const { overview, dataSummary, consentHistory } = data;
  const regionOptions: TailwindSelectOption[] = SUPPORTED_DATA_REGIONS.map((value) => ({
    value,
    label: value,
  }));
  const deletionRequested = Boolean(overview.deletionRequestedAt);

  return (
    <section aria-label={t("family.tabs.privacy")} className="grid gap-5">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}

      {/* 1. Privacy Overview */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-3">{t("family.privacy.overviewTitle")}</h3>
        {!overview.consentUpToDate ? (
          <Alert tone="warning" role="status" className="mb-3">
            {t("family.privacy.consentNeeded")}
          </Alert>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={t("family.privacy.acceptedPrivacyVersion")} value={overview.acceptedPrivacyVersion || "-"} />
          <Field label={t("family.privacy.currentPrivacyVersion")} value={overview.currentPrivacyVersion || "-"} />
          <Field label={t("family.privacy.acceptedTermsVersion")} value={overview.acceptedTermsVersion || "-"} />
          <Field label={t("family.privacy.currentTermsVersion")} value={overview.currentTermsVersion || "-"} />
          <Field label={t("family.privacy.parentalConsentAt")} value={formatDateTime(overview.parentalConsentAt)} />
          <Field label={t("family.privacy.parentalConsentBy")} value={overview.parentalConsentByUserId || "-"} />
          <Field label={t("family.privacy.dataRegion")} value={overview.dataRegion} />
          <Field label={t("family.privacy.familyCreatedAt")} value={formatDate(overview.familyCreatedAt)} />
          <Field label={t("family.privacy.lastActivityAt")} value={formatDateTime(overview.lastActivityAt)} />
          <Field
            label={t("family.privacy.consentStatus")}
            value={overview.consentUpToDate ? t("family.privacy.consentStatusCurrent") : t("family.privacy.consentStatusOutdated")}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a
            href="/privacy-policy"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline underline-offset-2">
            {t("family.privacy.viewPrivacyPolicy")}
          </a>
          <a
            href="/terms-of-service"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline underline-offset-2">
            {t("family.privacy.viewTermsOfService")}
          </a>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("family.privacy.dataRegion")}</span>
            <TailwindSelect
              ariaLabel={t("family.privacy.dataRegion")}
              className="min-w-[160px]"
              value={region}
              onChange={(value) => setRegion(value)}
              options={regionOptions}
            />
          </label>
          <Button
            type="button"
            className="btn btn-primary"
            disabled={busy === "consent"}
            onClick={() => void recordConsent()}>
            {busy === "consent"
              ? t("family.privacy.saving")
              : overview.consentUpToDate
                ? t("family.privacy.updateConsent")
                : t("family.privacy.recordConsent")}
          </Button>
        </div>
      </div>

      {/* 2. Family Data Summary */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-1">{t("family.privacy.summaryTitle")}</h3>
        <p className="small mb-3 text-slate-600">{t("family.privacy.summaryHelp")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {dataSummary.categories.map((category) => (
            <div
              key={category.key}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-700">
                {t(`family.privacy.summary.${category.key}`)}
              </span>
              <strong className="text-sm text-slate-900">
                {category.count === null ? t("family.privacy.summaryTracked") : category.count}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Download Family Data */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-1">{t("family.privacy.downloadTitle")}</h3>
        <p className="small mb-3 text-slate-600">{t("family.privacy.downloadHelp")}</p>
        <Button
          type="button"
          className="btn btn-primary"
          disabled={busy === "export"}
          onClick={() => void downloadExport()}>
          {busy === "export" ? t("family.privacy.preparing") : t("family.privacy.downloadAction")}
        </Button>
      </div>

      {/* 4. Consent History */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-3">{t("family.privacy.consentHistoryTitle")}</h3>
        <p className="small mb-3 text-slate-600">{t("family.privacy.consentHistoryHelp")}</p>
        <ConsentHistoryTable events={consentHistory ?? []} t={t} />
      </div>

      {/* 5. Delete Family Data Request */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-1">{t("family.privacy.deletionTitle")}</h3>
        {deletionRequested ? (
          <>
            <Alert tone="warning" role="status">
              {t("family.privacy.deletionScheduled", {
                date: formatDate(overview.deletionScheduledFor),
              })}
            </Alert>
            <div className="mt-3">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={busy === "deletion"}
                onClick={() => void cancelDeletion()}>
                {busy === "deletion" ? t("family.privacy.saving") : t("family.privacy.cancelDeletion")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="small mb-3 text-slate-600">{t("family.privacy.deletionHelp")}</p>
            <Button
              type="button"
              className="btn member-action-remove"
              disabled={busy === "deletion"}
              onClick={() => setPendingDeletion(true)}>
              {t("family.privacy.requestDeletion")}
            </Button>
          </>
        )}
      </div>

      <ModalShell open={pendingDeletion} onRequestClose={() => setPendingDeletion(false)}>
        <div className="family-modal-card">
          <div className="modal-dialog-title-row family-modal-title-row">
            <h3 className="family-modal-title">{t("family.privacy.requestDeletion")}</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setPendingDeletion(false)}
              aria-label={t("common.actions.close")}>
              X
            </Button>
          </div>
          <p className="mb-4 text-sm text-slate-600">{t("family.privacy.deletionConfirm")}</p>
          <div className="family-modal-actions">
            <Button type="button" className="btn btn-secondary" onClick={() => setPendingDeletion(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button type="button" className="btn member-action-remove" onClick={() => void requestDeletion()}>
              {t("family.privacy.requestDeletion")}
            </Button>
          </div>
        </div>
      </ModalShell>
    </section>
  );
}

const CONSENT_EVENT_LABELS: Record<string, string> = {
  TERMS_ACCEPTED: "Terms accepted",
  PRIVACY_ACCEPTED: "Privacy policy accepted",
  PARENTAL_CONSENT_RECORDED: "Parental consent recorded",
  CONSENT_WITHDRAWN: "Consent withdrawn",
};

const CONSENT_DOCUMENT_LABELS: Record<string, string> = {
  TERMS: "Terms of Service",
  PRIVACY_POLICY: "Privacy Policy",
  PARENTAL_CONSENT: "Parental Consent",
};

function ConsentHistoryTable({
  events,
  t,
}: {
  events: ConsentEvent[];
  t: (key: string) => string;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">{t("family.privacy.consentHistoryEmpty")}</p>
    );
  }
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[540px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">{t("family.privacy.consentHistoryDate")}</th>
            <th className="px-3 py-2">{t("family.privacy.consentHistoryEvent")}</th>
            <th className="px-3 py-2">{t("family.privacy.consentHistoryDocument")}</th>
            <th className="px-3 py-2">{t("family.privacy.consentHistoryVersion")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{formatDateTime(event.acceptedAt)}</td>
              <td className="px-3 py-2 font-medium text-slate-800">
                {CONSENT_EVENT_LABELS[event.eventType] ?? event.eventType}
              </td>
              <td className="px-3 py-2">
                {CONSENT_DOCUMENT_LABELS[event.documentType] ?? event.documentType}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{event.documentVersion || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </div>
  );
}
