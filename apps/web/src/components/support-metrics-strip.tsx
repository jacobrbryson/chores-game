"use client";

export type SupportMetricTone = "emerald" | "amber" | "sky" | "violet" | "rose" | "slate";

export type SupportMetric = {
  label: string;
  value: string | number;
  detail?: string;
  tone?: SupportMetricTone;
};

const METRIC_TONE_CLASSES: Record<SupportMetricTone, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
  amber: "border-amber-200 bg-amber-50 text-amber-950",
  sky: "border-sky-200 bg-sky-50 text-sky-950",
  violet: "border-violet-200 bg-violet-50 text-violet-950",
  rose: "border-rose-200 bg-rose-50 text-rose-950",
  slate: "border-slate-200 bg-slate-50 text-slate-950",
};

const METRIC_LABEL_TONE_CLASSES: Record<SupportMetricTone, string> = {
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  sky: "text-sky-700",
  violet: "text-violet-700",
  rose: "text-rose-700",
  slate: "text-slate-500",
};

export function SupportMetricsStrip({
  metrics,
  forceSingleRow = false,
}: {
  metrics: SupportMetric[];
  forceSingleRow?: boolean;
}) {
  return (
    <div>
      <section
        className={forceSingleRow ? "grid gap-2 sm:gap-3" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6"}
        style={forceSingleRow ? { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } : undefined}>
        {metrics.map((metric) => {
          const tone = metric.tone ?? "slate";
          return (
            <article
              key={metric.label}
              className={`min-w-0 rounded-2xl border p-2 shadow-sm sm:p-4 ${METRIC_TONE_CLASSES[tone]}`}>
              <div
                className={`truncate text-[0.62rem] font-semibold uppercase tracking-wide sm:text-xs ${METRIC_LABEL_TONE_CLASSES[tone]}`}>
                {metric.label}
              </div>
              <div className="mt-2 text-lg font-bold sm:text-2xl">{metric.value}</div>
              {metric.detail ? <div className="mt-1 truncate text-[0.62rem] opacity-75 sm:text-xs">{metric.detail}</div> : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
