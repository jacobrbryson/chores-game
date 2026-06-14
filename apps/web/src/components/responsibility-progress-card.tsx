"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { responsibilityPillarLabel } from "@/lib/responsibility/labels";
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.totalXp}</p>
              <p className="text-xs text-slate-500">{t("responsibility.progress.totalXp")}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.skillsLearned}</p>
              <p className="text-xs text-slate-500">
                {t("responsibility.progress.skillsLearned")}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-semibold text-slate-800">{progress.routinesCompleted}</p>
              <p className="text-xs text-slate-500">
                {t("responsibility.progress.routinesCompleted")}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
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

          <ul className="flex flex-col gap-3">
            {progress.pillars.map((entry) => {
              const percent = Math.round(entry.progressFraction * 100);
              return (
                <li key={entry.pillar} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {responsibilityPillarLabel(entry.pillar, t)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {t("responsibility.progress.level").replace("{level}", String(entry.level))}
                      {" · "}
                      {entry.xp} XP
                    </span>
                  </div>
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
