"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";

type ReacceptanceModalProps = {
  open: boolean;
  isFirstAcceptance: boolean;
  currentTermsVersion: string;
  currentPrivacyVersion: string;
  onAccepted: () => void | Promise<void>;
  onRequestClose?: () => void;
};

export function ReacceptanceModal({
  open,
  isFirstAcceptance,
  currentTermsVersion,
  currentPrivacyVersion,
  onAccepted,
  onRequestClose,
}: ReacceptanceModalProps) {
  const { t } = useLocale();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedParental, setAgreedParental] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allChecked = agreedTerms && agreedPrivacy && agreedParental;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allChecked || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/family/privacy/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataRegion: "US" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CONSENT_HTTP_${response.status}`);
      }
      await onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "reacceptance_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onRequestClose={onRequestClose ?? (() => undefined)}>
      <div className="reacceptance-modal">
        <h2 className="reacceptance-title">
          {isFirstAcceptance
            ? t("onboarding.reacceptance.firstTitle")
            : t("onboarding.reacceptance.title")}
        </h2>
        <p className="reacceptance-subtitle">
          {isFirstAcceptance
            ? t("onboarding.reacceptance.firstSubtitle")
            : t("onboarding.reacceptance.subtitle")}
        </p>
        <div className="reacceptance-versions">
          <span className="reacceptance-version-chip">
            {t("onboarding.reacceptance.termsVersion")}: <strong>{currentTermsVersion}</strong>
          </span>
          <span className="reacceptance-version-chip">
            {t("onboarding.reacceptance.privacyVersion")}: <strong>{currentPrivacyVersion}</strong>
          </span>
        </div>
        <div className="reacceptance-links">
          <Link href="/privacy-policy" target="_blank" rel="noreferrer" className="onboarding-link">
            {t("onboarding.reacceptance.viewPrivacyPolicy")}
          </Link>
          <Link
            href="/terms-of-service"
            target="_blank"
            rel="noreferrer"
            className="onboarding-link">
            {t("onboarding.reacceptance.viewTermsOfService")}
          </Link>
        </div>
        {error ? <Alert className="mt-3">{error}</Alert> : null}
        <form className="reacceptance-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="onboarding-checkboxes">
            <label className="onboarding-checkbox-label">
              <input
                type="checkbox"
                className="onboarding-checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                aria-label={t(isFirstAcceptance ? "onboarding.reacceptance.firstTerms" : "onboarding.reacceptance.terms")}
              />
              <span>{t(isFirstAcceptance ? "onboarding.reacceptance.firstTerms" : "onboarding.reacceptance.terms")}</span>
            </label>
            <label className="onboarding-checkbox-label">
              <input
                type="checkbox"
                className="onboarding-checkbox"
                checked={agreedPrivacy}
                onChange={(e) => setAgreedPrivacy(e.target.checked)}
                aria-label={t(isFirstAcceptance ? "onboarding.reacceptance.firstPrivacy" : "onboarding.reacceptance.privacy")}
              />
              <span>{t(isFirstAcceptance ? "onboarding.reacceptance.firstPrivacy" : "onboarding.reacceptance.privacy")}</span>
            </label>
            <label className="onboarding-checkbox-label">
              <input
                type="checkbox"
                className="onboarding-checkbox"
                checked={agreedParental}
                onChange={(e) => setAgreedParental(e.target.checked)}
                aria-label={t("onboarding.reacceptance.parental")}
              />
              <span>{t("onboarding.reacceptance.parental")}</span>
            </label>
          </div>
          <div className="onboarding-actions mt-4">
            {onRequestClose ? (
              <Button
                type="button"
                className="btn btn-secondary onboarding-secondary-cta"
                disabled={saving}
                onClick={onRequestClose}>
                {t("common.actions.cancel")}
              </Button>
            ) : null}
            <Button
              type="submit"
              className="btn btn-primary onboarding-cta"
              disabled={!allChecked || saving}>
              {saving
                ? t("onboarding.saving")
                : t(isFirstAcceptance ? "onboarding.reacceptance.firstCta" : "onboarding.reacceptance.cta")}
            </Button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}
