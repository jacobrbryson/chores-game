"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { triggerPartyConfetti } from "@/lib/confetti/party";
import { responsibilityTitleLabel } from "@/lib/responsibility/labels";
import type { PartyConfettiTriggerDetail } from "@/lib/confetti/party";
import {
  RESPONSIBILITY_PILLAR_EMOJI,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

// Shape surfaced by the chore PATCH response (`responsibilityXp.title`) plus the
// XP gained on this completion. Drives the Responsibility Identity celebration.
export type IdentityTitleCelebrationData = {
  pillar: ResponsibilityPillar;
  xpBefore?: number;
  xpAfter?: number;
  levelBefore?: number;
  levelAfter?: number;
  tier: number;
  nextTier: number | null;
  prevFraction: number;
  newFraction: number;
  unlocked: boolean;
  xpAwarded: number;
};

export function buildAllDoneProgressPayload(
  data: IdentityTitleCelebrationData,
  t: (key: string, values?: Record<string, string>) => string,
): NonNullable<PartyConfettiTriggerDetail["allDoneProgress"]> {
  const nextTitle =
    data.nextTier !== null ? responsibilityTitleLabel(data.pillar, data.nextTier, t) : "";
  const levelLabel = t("responsibility.progress.level", {
    level: String(data.levelAfter ?? data.levelBefore ?? 1),
  });
  const percent = Math.round(data.newFraction * 100);
  return {
    pillarLabel: `${RESPONSIBILITY_PILLAR_EMOJI[data.pillar]} ${t(`responsibility.pillars.${data.pillar}`)}`,
    currentTitle: data.tier >= 0 ? responsibilityTitleLabel(data.pillar, data.tier, t) : "",
    levelLabel,
    progressLabel: nextTitle
      ? t("responsibility.identity.progressToNext", {
          percent: String(percent),
          title: nextTitle,
        })
      : t("responsibility.identity.topTitle"),
    percent,
    xpLabel:
      data.xpAwarded > 0
        ? t("responsibility.routines.xpEarned", { xp: String(data.xpAwarded) })
        : undefined,
  };
}

// Lightweight, animated celebration shown after a chore completion that grew a
// Responsibility Pillar. Two modes:
//  - progress: "🏠 Home Care / Housekeeper / 62% to Chore Master" + a bar that
//    animates from the previous fraction up to the new one, and "+N XP".
//  - unlocked: a larger "New Title Unlocked" treatment that also fires confetti.
// The parent owns mount/unmount (and the auto-dismiss timer).
export function IdentityTitleCelebration({ data }: { data: IdentityTitleCelebrationData }) {
  const { t } = useLocale();
  const [barFraction, setBarFraction] = useState(data.unlocked ? 0 : data.prevFraction);

  useEffect(() => {
    // Animate the bar to its new value on the next frame so the CSS transition
    // runs from prevFraction → newFraction (or 0 → full when unlocked).
    const frame = requestAnimationFrame(() => {
      setBarFraction(data.unlocked ? 1 : data.newFraction);
    });
    if (data.unlocked) {
      triggerPartyConfetti({ intensity: 1.8, showAllDone: false });
    }
    return () => cancelAnimationFrame(frame);
  }, [data]);

  const emoji = RESPONSIBILITY_PILLAR_EMOJI[data.pillar];
  const pillarName = t(`responsibility.pillars.${data.pillar}`);
  const currentTitle =
    data.tier >= 0 ? responsibilityTitleLabel(data.pillar, data.tier, t) : "";
  const nextTitle =
    data.nextTier !== null ? responsibilityTitleLabel(data.pillar, data.nextTier, t) : "";
  const percent = Math.round(barFraction * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-3 rounded-xl border p-4 text-center shadow-sm ${
        data.unlocked
          ? "border-amber-300 bg-gradient-to-b from-amber-50 to-white"
          : "border-emerald-200 bg-emerald-50"
      }`}>
      {data.unlocked ? (
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          <span aria-hidden="true">🎉 </span>
          {t("responsibility.identity.titleUnlocked")}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-slate-600">
        <span aria-hidden="true">{emoji} </span>
        {pillarName}
      </p>
      {currentTitle ? (
        <p
          className={`font-bold text-slate-900 ${data.unlocked ? "text-2xl" : "text-lg"}`}>
          {currentTitle}
        </p>
      ) : null}
      <p className="mt-1 inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
        {t("responsibility.progress.level", {
          level: String(data.levelAfter ?? data.levelBefore ?? 1),
        })}
      </p>
      {nextTitle ? (
        <p className="mt-0.5 text-xs font-medium text-slate-500">
          {t("responsibility.identity.progressToNext", {
            percent: String(Math.round((data.unlocked ? data.newFraction : barFraction) * 100)),
            title: nextTitle,
          })}
        </p>
      ) : null}
      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/70"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}>
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            data.unlocked ? "bg-amber-400" : "bg-emerald-400"
          }`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {data.xpAwarded > 0 ? (
        <p className="mt-2 text-xs font-semibold text-emerald-700">
          {t("responsibility.routines.xpEarned", { xp: String(data.xpAwarded) })}
        </p>
      ) : null}
    </div>
  );
}
