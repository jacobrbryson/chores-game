"use client";

import { useLocale } from "@/components/locale-provider";

type AchievementProgressBarProps = {
  percent: number;
  completed: boolean;
  locked: boolean;
  className?: string;
};

export function AchievementProgressBar({
  percent,
  completed,
  locked,
  className = "",
}: AchievementProgressBarProps) {
  const { t } = useLocale();
  const safePercent = Math.max(0, Math.min(100, Math.floor(percent)));
  return (
    <div className={`w-full ${className}`}>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full transition-all duration-300 ${completed ? "bg-emerald-500" : locked ? "bg-slate-400" : "bg-sky-500"}`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div className="mt-1 text-center text-xs text-slate-600">
        {t("achievements.progressComplete", { percent: safePercent })}
      </div>
    </div>
  );
}
