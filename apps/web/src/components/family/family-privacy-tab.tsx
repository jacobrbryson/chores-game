"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { LegalDocumentContent } from "@/components/legal-document-content";
import { ModalShell } from "@/components/modal-shell";
import { ReacceptanceModal } from "@/components/reacceptance-modal";
import { showToast } from "@/components/toast";
import { useLocale } from "@/components/locale-provider";
import type { LegalDocument, LegalDocumentType } from "@/lib/legal/loader";
import type { PrivacyResponse } from "@/lib/privacy/types";

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
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [legalViewer, setLegalViewer] = useState<{
    documentType: LegalDocumentType;
    requestedVersion: string;
    document: LegalDocument | null;
    loading: boolean;
    error: string;
  } | null>(null);

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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "privacy_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function openAcceptedLegalDocument(documentType: LegalDocumentType, version: string) {
    setLegalViewer({
      documentType,
      requestedVersion: version,
      document: null,
      loading: true,
      error: "",
    });

    try {
      const params = new URLSearchParams();
      if (version) {
        params.set("version", version);
      }

      const response = await fetch(`/api/legal/${documentType}?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as LegalDocument & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `LEGAL_HTTP_${response.status}`);
      }

      setLegalViewer({
        documentType,
        requestedVersion: version,
        document: payload,
        loading: false,
        error: "",
      });
    } catch (actionError) {
      setLegalViewer({
        documentType,
        requestedVersion: version,
        document: null,
        loading: false,
        error:
          actionError instanceof Error
            ? actionError.message
            : "legal_document_version_unavailable",
      });
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
    return <Alert className="w-full">{t("family.privacy.loadError", { error })}</Alert>;
  }

  if (!data) {
    return null;
  }

  const { overview, dataSummary } = data;
  const deletionRequested = Boolean(overview.deletionRequestedAt);
  const acceptedPrivacyVersion =
    overview.acceptedPrivacyVersion || overview.currentPrivacyVersion;
  const acceptedTermsVersion =
    overview.acceptedTermsVersion || overview.currentTermsVersion;
  const hasPreviousVersionedConsent = Boolean(
    overview.parentalConsentAt ||
    overview.acceptedTermsVersion ||
    overview.acceptedPrivacyVersion,
  );
  const showConsentAction = !overview.consentUpToDate;
  const consentActionLabel = hasPreviousVersionedConsent
    ? t("family.privacy.updateConsent")
    : t("family.privacy.recordConsent");

  return (
    <section aria-label={t("family.tabs.privacy")} className="grid gap-5">
      {error ? <Alert className="w-full">{error}</Alert> : null}
      {notice ? <Alert tone="success" role="status" className="w-full">{notice}</Alert> : null}

      {/* 1. Privacy Overview */}
      <div className="family-page-card">
        <h3 className="family-modal-title mb-3">{t("family.privacy.overviewTitle")}</h3>
        {!overview.consentUpToDate ? (
          <Alert tone="warning" role="status" className="mb-3">
            {t("family.privacy.consentNeeded")}
          </Alert>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={t("family.privacy.acceptedVersion")} value={overview.acceptedLegalVersion || "-"} />
          <Field label={t("family.privacy.currentVersion")} value={overview.currentLegalVersion || "-"} />
          <Field label={t("family.privacy.acceptedAt")} value={formatDateTime(overview.parentalConsentAt)} />
          <Field
            label={t("family.privacy.parentalConsentBy")}
            value={
              overview.parentalConsentByDisplayName ||
              overview.parentalConsentByUserId ||
              "-"
            }
          />
          <Field label={t("family.privacy.familyCreatedAt")} value={formatDate(overview.familyCreatedAt)} />
          <Field label={t("family.privacy.lastActivityAt")} value={formatDateTime(overview.lastActivityAt)} />
          <Field
            label={t("family.privacy.consentStatus")}
            value={overview.consentUpToDate ? t("family.privacy.consentStatusCurrent") : t("family.privacy.consentStatusOutdated")}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="text-blue-600 underline underline-offset-2"
            onClick={() =>
              void openAcceptedLegalDocument("privacy-policy", acceptedPrivacyVersion)
            }>
            {t("family.privacy.viewPrivacyPolicy")}
          </button>
          <button
            type="button"
            className="text-blue-600 underline underline-offset-2"
            onClick={() =>
              void openAcceptedLegalDocument("terms-of-service", acceptedTermsVersion)
            }>
            {t("family.privacy.viewTermsOfService")}
          </button>
          <Link
            href="/family/privacy/consent-history"
            className="text-blue-600 underline underline-offset-2">
            {t("family.privacy.viewConsentHistory")}
          </Link>
        </div>
        {showConsentAction ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Button
              type="button"
              className="btn btn-primary"
              onClick={() => setConsentDialogOpen(true)}>
              {consentActionLabel}
            </Button>
          </div>
        ) : null}
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
      <div className="family-page-card family-privacy-action-card">
        <h3 className="family-modal-title mb-1">{t("family.privacy.downloadTitle")}</h3>
        <p className="small mb-3 text-slate-600">{t("family.privacy.downloadHelp")}</p>
        <Button
          type="button"
          className="btn btn-secondary mt-auto self-start"
          disabled={busy === "export"}
          onClick={() => void downloadExport()}>
          {busy === "export" ? t("family.privacy.preparing") : t("family.privacy.downloadAction")}
        </Button>
      </div>

      {/* 4. Delete Family Data Request */}
      <div className="family-page-card family-privacy-action-card">
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
              className="btn btn-secondary mt-auto self-start"
              disabled={busy === "deletion"}
              onClick={() => setPendingDeletion(true)}>
              {t("family.privacy.requestDeletionAction")}
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

      <ReacceptanceModal
        open={consentDialogOpen}
        isFirstAcceptance={!hasPreviousVersionedConsent}
        currentTermsVersion={overview.currentTermsVersion}
        currentPrivacyVersion={overview.currentPrivacyVersion}
        onRequestClose={() => setConsentDialogOpen(false)}
        onAccepted={async () => {
          setConsentDialogOpen(false);
          await load();
          showToast(t("family.privacy.consentRecorded"), "success");
        }}
      />

      <ModalShell open={Boolean(legalViewer)} onRequestClose={() => setLegalViewer(null)}>
        <div className="flex w-[min(960px,92vw)] max-h-[85vh] flex-col gap-4 overflow-hidden rounded-[28px] bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="family-modal-title">
                {legalViewer?.document?.title ??
                  (legalViewer?.documentType === "privacy-policy"
                    ? t("family.privacy.privacyPolicy")
                    : t("family.privacy.termsOfService"))}
              </h3>
              <p className="small mt-1 text-slate-600">
                {t("family.privacy.acceptedVersion")}:{" "}
                {legalViewer?.requestedVersion || "-"}
              </p>
            </div>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setLegalViewer(null)}
              aria-label={t("common.actions.close")}>
              X
            </Button>
          </div>

          {legalViewer?.loading ? (
            <div aria-hidden="true" className="grid gap-3 overflow-y-auto pr-1">
              <div className="family-skeleton h-5 w-48" />
              <div className="family-skeleton h-24 w-full" />
              <div className="family-skeleton h-24 w-full" />
              <div className="family-skeleton h-24 w-full" />
            </div>
          ) : null}

          {!legalViewer?.loading && legalViewer?.error ? (
            <Alert>
              {t("family.privacy.legalDocumentUnavailable", {
                version: legalViewer.requestedVersion || "-",
              })}
            </Alert>
          ) : null}

          {!legalViewer?.loading && legalViewer?.document ? (
            <div className="overflow-y-auto pr-1">
              <LegalDocumentContent document={legalViewer.document} className="legal-page" />
            </div>
          ) : null}
        </div>
      </ModalShell>
    </section>
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
