"use client";

import { useMemo } from "react";

type SupportActivityChartPoint = {
  date: string;
  count: number;
};

function formatShortDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatWeekdayDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function buildAxisTicks<T>(items: T[]) {
  if (items.length === 0) {
    return [] as Array<{ item: T; index: number }>;
  }
  const indexes = Array.from(
    new Set([0, Math.floor((items.length - 1) / 3), Math.floor(((items.length - 1) * 2) / 3), items.length - 1]),
  );
  return indexes.map((index) => ({ item: items[index], index }));
}

function formatUpdatedAt(value: string) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}

function buildLast30DayBuckets(series: SupportActivityChartPoint[]) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const buckets = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (29 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      key,
      date,
      label: formatShortDate(date),
      fullLabel: formatWeekdayDate(date),
      count: 0,
    };
  });

  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket] as const));
  for (const entry of series) {
    const key = entry.date;
    const bucket = bucketByKey.get(key);
    if (!bucket) {
      continue;
    }
    bucket.count = Math.max(0, Math.trunc(entry.count));
  }

  return buckets;
}

export function SupportActivityChart({
  series,
  updatedAt,
}: {
  series: SupportActivityChartPoint[];
  updatedAt?: string;
}) {
  const chart = useMemo(() => {
    const buckets = buildLast30DayBuckets(series);
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const axisTicks = buildAxisTicks(buckets).map(({ item, index }) => ({
      key: item.key,
      label: item.label,
      leftPercent: `${(index / Math.max(1, buckets.length - 1)) * 100}%`,
    }));
    const points = buckets
      .map((bucket, index) => {
        const x = (index / Math.max(1, buckets.length - 1)) * 100;
        const y = 100 - (bucket.count / maxCount) * 100;
        return `${x},${y}`;
      })
      .join(" ");
    return { buckets, maxCount, points, axisTicks };
  }, [series]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">30-Day Audit Activity</h3>
            <p className="mt-1 text-sm text-slate-600">
              Daily audit-log volume for the last 30 days, sourced from stored support metrics.
            </p>
          </div>
          {formatUpdatedAt(updatedAt ?? "") ? (
            <div className="text-xs text-slate-500">Updated {formatUpdatedAt(updatedAt ?? "")}</div>
          ) : null}
        </div>
      </div>
      <div className="p-5">
        <div className="relative rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#fcfcfb_0%,#f8fafc_100%)] p-4">
          <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <span>Daily volume</span>
            <span>Peak: {chart.maxCount}</span>
          </div>
          <div className="h-72">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              {[8, 28, 48, 68, 88].map((y, index) => (
                <path
                  key={y}
                  d={`M0 ${y} C 12 ${y + (index % 2 === 0 ? 0.8 : -0.8)}, 32 ${y + (index % 2 === 0 ? -0.6 : 0.6)}, 50 ${y} S 84 ${y + (index % 2 === 0 ? 0.7 : -0.7)}, 100 ${y}`}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="0.55"
                  strokeDasharray="1.8 1.6"
                />
              ))}
              <path
                d={`M0 100 L ${chart.points} L 100 100`}
                fill="rgba(148, 163, 184, 0.16)"
                stroke="none"
              />
              <polyline
                fill="none"
                stroke="#334155"
                strokeWidth="2.3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={chart.points}
                opacity="0.24"
                transform="translate(0.45 0.8)"
              />
              <polyline
                fill="none"
                stroke="#0f172a"
                strokeWidth="1.95"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={chart.points}
                strokeDasharray="0.01 0"
              />
              {chart.buckets.map((bucket, index) => {
                const x = (index / Math.max(1, chart.buckets.length - 1)) * 100;
                const y = 100 - (bucket.count / chart.maxCount) * 100;
                return (
                  <g key={bucket.key}>
                    <title>{bucket.fullLabel}: {bucket.count} audit event{bucket.count === 1 ? "" : "s"}</title>
                    <circle cx={x + 0.16} cy={y + 0.42} r="1.26" fill="#94a3b8" opacity="0.28" />
                    <circle cx={x} cy={y} r="1.18" fill="#0f172a" />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="relative mt-3 h-5 text-[11px] text-slate-500">
            {chart.axisTicks.map((tick) => (
              <div
                key={tick.key}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: tick.leftPercent }}>
                {tick.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
