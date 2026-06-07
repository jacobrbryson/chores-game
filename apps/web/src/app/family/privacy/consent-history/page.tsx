"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { FamilyConsentHistoryTable } from "@/components/family/family-consent-history-table";
import { useLocale } from "@/components/locale-provider";
import type { PrivacyResponse } from "@/lib/privacy/types";

export default function FamilyConsentHistoryPage() {
  const { t } = useLocale();
  const [data, setData] = useState<PrivacyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
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
    })();
  }, []);

  return (
    <main className="panel family-page family-page-shell">
      <section className="family-page-card">
        <div className="mb-4 flex flex-col gap-2">
          <Link
            href="/family?tab=privacy"
            className="text-sm text-blue-600 underline underline-offset-2">
            {t("family.privacy.backToPrivacy")}
          </Link>
          <h1 className="family-modal-title">{t("family.privacy.consentHistoryTitle")}</h1>
          <p className="small text-slate-600">{t("family.privacy.consentHistoryHelp")}</p>
        </div>

        {loading ? (
          <div aria-hidden="true" className="grid gap-3">
            <div className="family-skeleton h-5 w-40" />
            <div className="family-skeleton h-24 w-full" />
            <div className="family-skeleton h-24 w-full" />
          </div>
        ) : null}

        {!loading && error ? (
          <Alert>{t("family.privacy.loadError", { error })}</Alert>
        ) : null}

        {!loading && !error && data ? (
          <FamilyConsentHistoryTable events={data.consentHistory ?? []} />
        ) : null}
      </section>
    </main>
  );
}
