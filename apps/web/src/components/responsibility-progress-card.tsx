"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import {
  responsibilityPillarLabel,
  responsibilityTitleLabel,
} from "@/lib/responsibility/labels";
import { hasEarnedIdentity } from "@/lib/responsibility/identity";
import {
  RESPONSIBILITY_PILLAR_EMOJI,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

type PillarProgress = {
  pillar: ResponsibilityPillar;
  xp: number;
  level: number;
  currentLevelFloorXp: number;
  nextLevelXp: number | null;
  progressFraction: number;
  titleTier: number;
  nextTitleTier: number | null;
  titleProgressFraction: number;
};

type ProgressSummary = {
  playerId: string;
  totalXp: number;
  skillsLearned: number;
  routinesCompleted: number;
  mostActivePillar: ResponsibilityPillar | "";
  mostCompletedRoutine: { routineId: string; name: string; count: number } | null;
  pillars: PillarProgress[];
};

// "Responsibility Progress" card: per-pillar XP bars with levels plus headline
// stats. Used on the profile page; pass memberId for the admin view of a
// specific child.
export function ResponsibilityProgressCard({ memberId }: { memberId?: string }) {
  const { t } = useLocale();
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : "";
        const response = await fetch(`/api/responsibility/progress${query}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as { progress?: ProgressSummary };
        if (!response.ok || !payload.progress) {
          throw new Error("responsibility_progress_unavailable");
        }
        if (!cancelled) {
          setProgress(payload.progress);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  if (failed) {
    return null;
  }

  return (
    <section
      aria-label={t("responsibility.progress.title")}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="family-page-card-header">
        <div>
          <h2>{t("responsibility.progress.title")}</h2>
          <p className="small family-page-subhead">{t("responsibility.progress.subtitle")}</p>
        </div>
      </div>

      {loading || !progress ? (
        <p className="text-sm text-slate-500">{t("common.actions.loading")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="responsibility-progress-stats">
            <div className="flex min-h-20 flex-col items-center justify-center rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.totalXp}</p>
              <p className="text-xs text-slate-500">{t("responsibility.progress.totalXp")}</p>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.skillsLearned}</p>
              <p className="text-xs text-slate-500">
                {t("responsibility.progress.skillsLearned")}
              </p>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.routinesCompleted}</p>
              <p className="text-xs text-slate-500">
                {t("responsibility.progress.routinesCompleted")}
              </p>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">
                {progress.mostActivePillar
                  ? RESPONSIBILITY_PILLAR_EMOJI[progress.mostActivePillar]
                  : "—"}
              </p>
              <p className="text-xs text-slate-500">
                {progress.mostActivePillar
                  ? t(`responsibility.pillars.${progress.mostActivePillar}`)
                  : t("responsibility.progress.mostActivePillar")}
              </p>
            </div>
          </div>

          {progress.mostCompletedRoutine ? (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {t("responsibility.progress.mostCompletedRoutine", {
                name: progress.mostCompletedRoutine.name,
                count: String(progress.mostCompletedRoutine.count),
              })}
            </p>
          ) : null}

          {progress.pillars.some(hasEarnedIdentity) ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-slate-500">
                {t("responsibility.identity.earnedIdentities")}
              </p>
              <div className="flex flex-wrap gap-2">
                {progress.pillars
                  .filter(hasEarnedIdentity)
                  .map((entry) => (
                    <span
                      key={entry.pillar}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      <span aria-hidden="true">{RESPONSIBILITY_PILLAR_EMOJI[entry.pillar]}</span>
                      {responsibilityTitleLabel(entry.pillar, entry.titleTier, t)}
                    </span>
                  ))}
              </div>
            </div>
          ) : null}

          <ul className="flex flex-col gap-4">
            {progress.pillars.map((entry) => {
              const percent = Math.round(entry.titleProgressFraction * 100);
              const nextTitle =
                entry.nextTitleTier !== null
                  ? responsibilityTitleLabel(entry.pillar, entry.nextTitleTier, t)
                  : "";
              return (
                <li key={entry.pillar} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-600">
                      {responsibilityPillarLabel(entry.pillar, t)}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        <span className="sr-only">
                          {t("responsibility.progress.level").replace("{level}", String(entry.level))}
                        </span>
                        {entry.level}
                      </span>
                      <span className="text-[11px] text-slate-400">{entry.xp} XP</span>
                    </span>
                  </div>
                  {nextTitle ? (
                    <p className="text-xs font-medium text-slate-500">
                      {t("responsibility.identity.progressToNext", {
                        percent: String(percent),
                        title: nextTitle,
                      })}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-amber-600">
                      {t("responsibility.identity.topTitle")}
                    </p>
                  )}
                  <div
                    className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}>
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{ width: `${Math.max(2, percent)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
