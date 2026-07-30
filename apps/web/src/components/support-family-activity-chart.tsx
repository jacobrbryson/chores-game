"use client";

import { useMemo, useRef, useState } from "react";
import type { SupportFamilyActivityPoint } from "@/lib/support/dashboard-metrics";

type MetricKey =
  | "newFamilies"
  | "newUsers"
  | "choresCreated"
  | "routinesCreated"
  | "choresCompleted"
  | "routinesCompleted";

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "newFamilies", label: "New Families", color: "#0284c7" },
  { key: "newUsers", label: "New Users", color: "#7c3aed" },
  { key: "choresCreated", label: "Chores Created", color: "#059669" },
  { key: "routinesCreated", label: "Routines Created", color: "#d97706" },
  { key: "choresCompleted", label: "Chores Completed", color: "#0f766e" },
  { key: "routinesCompleted", label: "Routines Completed", color: "#e11d48" },
];

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

function buildLast30DayBuckets(series: SupportFamilyActivityPoint[]) {
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
      newFamilies: 0,
      newUsers: 0,
      choresCreated: 0,
      routinesCreated: 0,
      choresCompleted: 0,
      routinesCompleted: 0,
    };
  });

  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket] as const));
  for (const entry of series) {
    const bucket = bucketByKey.get(entry.date);
    if (!bucket) {
      continue;
    }
    bucket.newFamilies = Math.max(0, Math.trunc(entry.newFamilies));
    bucket.newUsers = Math.max(0, Math.trunc(entry.newUsers));
    bucket.choresCreated = Math.max(0, Math.trunc(entry.choresCreated));
    bucket.routinesCreated = Math.max(0, Math.trunc(entry.routinesCreated));
    bucket.choresCompleted = Math.max(0, Math.trunc(entry.choresCompleted));
    bucket.routinesCompleted = Math.max(0, Math.trunc(entry.routinesCompleted));
  }

  return buckets;
}

export function SupportFamilyActivityChart({
  series,
  updatedAt,
}: {
  series: SupportFamilyActivityPoint[];
  updatedAt?: string;
}) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const buckets = buildLast30DayBuckets(series);
    const maxCount = Math.max(
      1,
      ...buckets.flatMap((bucket) => METRICS.map((metric) => bucket[metric.key])),
    );
    const axisTicks = buildAxisTicks(buckets).map(({ item, index }) => ({
      key: item.key,
      label: item.label,
      leftPercent: `${(index / Math.max(1, buckets.length - 1)) * 100}%`,
    }));
    const lines = METRICS.map((metric) => {
      const total = buckets.reduce((sum, bucket) => sum + bucket[metric.key], 0);
      const points = buckets
        .map((bucket, index) => {
          const x = (index / Math.max(1, buckets.length - 1)) * 100;
          const y = 100 - (bucket[metric.key] / maxCount) * 100;
          return `${x},${y}`;
        })
        .join(" ");
      return { ...metric, total, points };
    });
    return { buckets, maxCount, axisTicks, lines };
  }, [series]);

  function handlePlotMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const plot = plotRef.current;
    if (!plot || chart.buckets.length === 0) {
      return;
    }
    const rect = plot.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    const index = Math.round(ratio * (chart.buckets.length - 1));
    setHoverIndex(Math.max(0, Math.min(chart.buckets.length - 1, index)));
  }

  const hovered = hoverIndex === null ? null : chart.buckets[hoverIndex];
  const hoverLeftPercent =
    hoverIndex === null ? 0 : (hoverIndex / Math.max(1, chart.buckets.length - 1)) * 100;
  // Flip the tooltip to the left of the hover line once past the midpoint so it
  // never clips outside the plot area.
  const tooltipOnLeft = hoverLeftPercent > 55;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">30-Day Family Activity</h3>
            <p className="mt-1 text-sm text-slate-600">
              Daily new families, new users, and chore/routine creation and completion for the last 30 days.
            </p>
          </div>
          {formatUpdatedAt(updatedAt ?? "") ? (
            <div className="text-xs text-slate-500">Updated {formatUpdatedAt(updatedAt ?? "")}</div>
          ) : null}
        </div>
      </div>
      <div className="p-5">
        <div className="relative rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#fcfcfb_0%,#f8fafc_100%)] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-600">
            {chart.lines.map((line) => (
              <div key={line.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: line.color }}
                />
                <span>
                  {line.label} <span className="text-slate-400">({line.total})</span>
                </span>
              </div>
            ))}
          </div>
          <div
            ref={plotRef}
            className="relative h-72"
            onMouseMove={handlePlotMouseMove}
            onMouseLeave={() => setHoverIndex(null)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              {[8, 28, 48, 68, 88].map((y, index) => (
                <path
                  key={y}
                  d={`M0 ${y} C 12 ${y + (index % 2 === 0 ? 0.8 : -0.8)}, 32 ${y + (index % 2 === 0 ? -0.6 : 0.6)}, 50 ${y} S 84 ${y + (index % 2 === 0 ? 0.7 : -0.7)}, 100 ${y}`}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {chart.lines.map((line) => (
                <polyline
                  key={line.key}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={line.points}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {hovered ? (
                <line
                  x1={hoverLeftPercent}
                  y1="0"
                  x2={hoverLeftPercent}
                  y2="100"
                  stroke="#64748b"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            {hovered
              ? chart.lines.map((line) => (
                  <span
                    key={`hover-${line.key}`}
                    className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{
                      backgroundColor: line.color,
                      left: `${hoverLeftPercent}%`,
                      top: `${100 - (hovered[line.key] / chart.maxCount) * 100}%`,
                    }}
                  />
                ))
              : null}
            {hovered ? (
              <div
                className="pointer-events-none absolute top-2 z-10 w-52 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-lg"
                style={
                  tooltipOnLeft
                    ? { right: `calc(${100 - hoverLeftPercent}% + 10px)` }
                    : { left: `calc(${hoverLeftPercent}% + 10px)` }
                }>
                <div className="mb-2 font-bold text-slate-900">{hovered.fullLabel}</div>
                <div className="flex flex-col gap-1">
                  {chart.lines.map((line) => (
                    <div key={`tip-${line.key}`} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: line.color }}
                        />
                        {line.label}
                      </span>
                      <span className="font-semibold text-slate-900">{hovered[line.key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
