"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { IdentitySummaryStrip } from "@/components/identity-summary-strip";
import { hasEarnedIdentity, type PillarIdentity } from "@/lib/responsibility/identity";

// "Who they are" identity card for a profile: the child's earned pillar titles.
// Self-fetching so it drops cleanly into both the own-profile and admin
// member-profile pages. Renders nothing until at least one title is earned, so
// it never shows an empty shell for a brand-new member. The full title-led
// Responsibility Progress card still renders below it.
export function ProfileIdentityCard({ memberId }: { memberId?: string }) {
  const { t } = useLocale();
  const [identities, setIdentities] = useState<PillarIdentity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : "";
        const response = await fetch(`/api/responsibility/progress${query}`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          progress?: { pillars?: PillarIdentity[] };
        };
        if (!cancelled && payload.progress?.pillars) {
          setIdentities(payload.progress.pillars);
        }
      } catch {
        // Best-effort — stay hidden on failure.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  if (!identities || identities.every((entry) => !hasEarnedIdentity(entry))) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label={t("responsibility.identity.earnedIdentities")}>
      <h2 className="text-sm font-medium text-slate-500">
        {t("responsibility.identity.earnedIdentities")}
      </h2>
      <IdentitySummaryStrip identities={identities} limit={3} variant="rows" className="mt-2" />
    </section>
  );
}
