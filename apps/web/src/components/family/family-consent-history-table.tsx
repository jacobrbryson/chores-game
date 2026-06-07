"use client";

import { useLocale } from "@/components/locale-provider";
import type { ConsentEvent } from "@/lib/privacy/types";

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
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

type FamilyConsentHistoryTableProps = {
  events: ConsentEvent[];
};

export function FamilyConsentHistoryTable({
  events,
}: FamilyConsentHistoryTableProps) {
  const { t } = useLocale();

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
