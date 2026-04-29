"use client";

import { AchievementProgressBar } from "@/components/achievements/achievement-progress-bar";
import type { AchievementResponseItem } from "@/lib/achievements/service";

type AchievementCardProps = {
  achievement: AchievementResponseItem;
  highlighted: boolean;
  cardRef?: (node: HTMLDivElement | null) => void;
};

export function AchievementCard({ achievement, highlighted, cardRef }: AchievementCardProps) {
  const cardTone = achievement.completed
    ? "border-emerald-300 bg-emerald-50"
    : achievement.restricted
      ? "border-slate-300 bg-slate-100 opacity-80"
      : "border-slate-300 bg-white";
  return (
    <article
      id={achievement.id}
      ref={cardRef}
      className={`rounded-2xl border p-4 shadow-sm transition ${cardTone} ${highlighted ? "ring-4 ring-amber-300" : ""}`}>
      <div className="flex items-start gap-3">
        <img
          src={achievement.imageUrl}
          alt=""
          className={`h-16 w-16 rounded-xl border object-cover ${achievement.restricted ? "grayscale" : ""}`}
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).src = "/store3/theme.png";
          }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900">{achievement.wittyTitle}</h3>
          <p className="mt-1 text-sm text-slate-700">{achievement.title}</p>
          <p className="mt-1 text-xs text-slate-600">{achievement.description}</p>
          <div className="mt-2">
            <AchievementProgressBar
              percent={achievement.percentComplete}
              completed={achievement.completed}
              locked={achievement.locked}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
