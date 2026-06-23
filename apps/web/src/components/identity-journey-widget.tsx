"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import { primaryJourneyPillar, type PillarIdentity } from "@/lib/responsibility/identity";
import { responsibilityTitleLabel } from "@/lib/responsibility/labels";
import { RESPONSIBILITY_PILLAR_EMOJI } from "@/lib/responsibility/types";

type PillarProgress = PillarIdentity & {
  level: number;
};

// Dashboard "Your Journey" widget for players: features the pillar the child is
// most invested in, showing their current title and how close they are to the
// next one. Tapping opens the full Responsibility Pillars view on the profile
// page. Renders nothing until a pillar has XP (no empty/zero state to clutter a
// new player's dashboard).
export function IdentityJourneyWidget() {
  const { t } = useLocale();
  const [pillars, setPillars] = useState<PillarProgress[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/responsibility/progress", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { progress?: { pillars?: PillarProgress[] } };
        if (!cancelled && payload.progress?.pillars) {
          setPillars(payload.progress.pillars);
        }
      } catch {
        // Best-effort widget — stay hidden on failure.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const primary = pillars ? primaryJourneyPillar(pillars) : null;
  if (!primary) {
    return null;
  }

  const pillarName = t(`responsibility.pillars.${primary.pillar}`);
  const currentTitle = responsibilityTitleLabel(primary.pillar, primary.titleTier, t);
  const nextTitle =
    primary.nextTitleTier !== null
      ? responsibilityTitleLabel(primary.pillar, primary.nextTitleTier, t)
      : "";
  const percent = Math.round(primary.titleProgressFraction * 100);

  return (
    <Link href="/profile" className="identity-journey-card" aria-label={t("responsibility.identity.journeyTitle")}>
      <div className="identity-journey-header">
        <span className="identity-journey-eyebrow">{t("responsibility.identity.journeyTitle")}</span>
        <span className="identity-journey-pillar">
          <span aria-hidden="true">{RESPONSIBILITY_PILLAR_EMOJI[primary.pillar]}</span> {pillarName}
        </span>
      </div>
      <p className="identity-journey-title">{currentTitle}</p>
      {nextTitle ? (
        <p className="identity-journey-next">
          {t("responsibility.identity.progressToNext", { percent: String(percent), title: nextTitle })}
        </p>
      ) : (
        <p className="identity-journey-next identity-journey-next-top">
          {t("responsibility.identity.topTitle")}
        </p>
      )}
      <div
        className="identity-journey-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}>
        <div className="identity-journey-bar-fill" style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
    </Link>
  );
}
