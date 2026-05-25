"use client";

import { AchievementProgressBar } from "@/components/achievements/achievement-progress-bar";
import type { AchievementResponseItem } from "@/lib/achievements/service";

type AchievementCardProps = {
  achievement: AchievementResponseItem;
  highlighted: boolean;
  cardRef?: (node: HTMLDivElement | null) => void;
};

export function AchievementCard({ achievement, highlighted, cardRef }: AchievementCardProps) {
  const completedDateLabel = achievement.completedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(achievement.completedAt))
    : "";

  const cardTone = achievement.completed
    ? "border-emerald-300"
    : achievement.restricted
      ? "border-slate-300 opacity-80"
      : "border-slate-300 opacity-90";

  const cardBackground = achievement.restricted
    ? "linear-gradient(160deg, #f1f5f9 0%, #e2e8f0 100%)"
    : achievement.completed
      ? "linear-gradient(160deg, color-mix(in srgb, var(--theme-primary) 22%, #ffffff) 0%, color-mix(in srgb, var(--theme-secondary) 18%, #ffffff) 55%, color-mix(in srgb, var(--theme-tertiary) 10%, #ffffff) 100%)"
      : "linear-gradient(160deg, color-mix(in srgb, var(--theme-primary) 14%, #ffffff) 0%, color-mix(in srgb, var(--theme-secondary) 10%, #ffffff) 55%, #ffffff 100%)";

  return (
    <article
      id={achievement.id}
      ref={cardRef}
      className={`rounded-xl border p-4 shadow-sm transition ${cardTone} ${highlighted ? "ring-4 ring-amber-300" : ""}`}
      style={{ backgroundImage: cardBackground }}>
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16 shrink-0">
          <img
            src={achievement.imageUrl}
            alt=""
            className={`h-16 w-16 rounded-xl border object-cover ${achievement.restricted ? "grayscale" : achievement.completed ? "" : "grayscale-[35%] saturate-50 brightness-95"}`}
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).src = "/store3/theme.png";
            }}
          />
          {!achievement.completed ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl bg-slate-100/45"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 self-center">
          <h3 className="truncate text-base font-semibold text-slate-900">{achievement.wittyTitle}</h3>
          <p className="mt-1 text-sm text-slate-700">{achievement.title}</p>
          <p className="mt-1 text-xs text-slate-600">{achievement.description}</p>
        </div>
      </div>
      <div className="mt-3 w-full border-t border-slate-300/70 pt-3">
        {achievement.completed ? (
          <div className="flex min-h-8 items-center justify-center">
            <p className="text-center text-[11px] text-slate-500">
            {completedDateLabel ? `Completed ${completedDateLabel}` : "Completed"}
            </p>
          </div>
        ) : (
          <AchievementProgressBar
            percent={achievement.percentComplete}
            completed={achievement.completed}
            locked={achievement.locked}
          />
        )}
      </div>
    </article>
  );
}
