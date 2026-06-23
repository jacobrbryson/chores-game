"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { IdentitySummaryStrip } from "@/components/identity-summary-strip";
import type { PillarIdentity } from "@/lib/responsibility/identity";

type IdentitiesResponse = {
  members?: Array<{ uid: string; identities: PillarIdentity[] }>;
};

type SummaryMember = {
  uid?: string;
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  dashboardPrimaryColor?: string;
  role: "admin" | "player";
};

type SummaryResponse = {
  members?: SummaryMember[];
};

type GrowthRow = {
  uid: string;
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
  identities: PillarIdentity[];
};

// Parent-facing "Family Growth" recognition: each child with a Responsibility
// title, surfaced on the dashboard so parents see growth without opening every
// profile. Shows each member's single highest title. Hides itself entirely when
// no child has started a pillar yet.
export function FamilyGrowthCard() {
  const { t } = useLocale();
  const [rows, setRows] = useState<GrowthRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [identitiesRes, summaryRes] = await Promise.all([
          fetch("/api/responsibility/identities", { cache: "no-store" }),
          fetch("/api/family/summary", { cache: "no-store" }),
        ]);
        if (!identitiesRes.ok || !summaryRes.ok) {
          return;
        }
        const identitiesPayload = (await identitiesRes.json()) as IdentitiesResponse;
        const summaryPayload = (await summaryRes.json()) as SummaryResponse;
        const identitiesByUid = new Map(
          (identitiesPayload.members ?? []).map((entry) => [entry.uid, entry.identities]),
        );
        const built: GrowthRow[] = (summaryPayload.members ?? [])
          .map((member): GrowthRow | null => {
            const identities = member.uid ? identitiesByUid.get(member.uid) : undefined;
            if (!member.uid || !identities || identities.length === 0) {
              return null;
            }
            return {
              uid: member.uid,
              name: member.name,
              avatarId: member.avatarId,
              avatarPhotoUrl: member.avatarPhotoUrl,
              primaryColor: member.dashboardPrimaryColor,
              identities,
            };
          })
          .filter((row): row is GrowthRow => row !== null);
        if (!cancelled) {
          setRows(built);
        }
      } catch {
        // Best-effort recognition card — stay hidden on failure.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows || rows.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label={t("responsibility.identity.familyGrowth")}>
      <div className="family-page-card-header">
        <div>
          <h2>{t("responsibility.identity.familyGrowth")}</h2>
          <p className="small family-page-subhead">
            {t("responsibility.identity.familyGrowthSubtitle")}
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.uid} className="flex items-center gap-3">
            <FamilyMemberAvatar
              name={row.name}
              avatarId={row.avatarId || undefined}
              avatarPhotoUrl={row.avatarPhotoUrl || undefined}
              primaryColor={row.primaryColor || undefined}
              size={36}
              ariaHidden
            />
            <span className="font-medium text-slate-700">{row.name}</span>
            <IdentitySummaryStrip
              identities={row.identities}
              limit={1}
              variant="chips"
              className="ml-auto"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
