import type { WeeklyWindow } from "@/lib/newsletters/types";

const DAY_MILLIS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getPreviousWeeklyWindow(now = new Date()): WeeklyWindow {
  // Rolling 7-day window ending today (inclusive). e.g. if today is June 6, the
  // window spans May 30 through June 6 rather than the prior calendar week.
  const todayStart = startOfUtcDay(now);
  const weekStart = new Date(todayStart.getTime() - 7 * DAY_MILLIS);
  const weekEnd = new Date(todayStart.getTime() + DAY_MILLIS - 1);
  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    weekStartDateOnly: weekStart.toISOString().slice(0, 10),
    weekEndDateOnly: weekEnd.toISOString().slice(0, 10),
  };
}

export function isIsoWithinWindow(value: string, window: WeeklyWindow) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    return false;
  }
  return millis >= Date.parse(window.weekStart) && millis <= Date.parse(window.weekEnd);
}
