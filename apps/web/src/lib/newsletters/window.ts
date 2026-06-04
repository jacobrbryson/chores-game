import type { WeeklyWindow } from "@/lib/newsletters/types";

const DAY_MILLIS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getPreviousWeeklyWindow(now = new Date()): WeeklyWindow {
  const currentDay = startOfUtcDay(now);
  const mondayOffset = (currentDay.getUTCDay() + 6) % 7;
  const currentWeekStartMillis = currentDay.getTime() - mondayOffset * DAY_MILLIS;
  const previousWeekStart = new Date(currentWeekStartMillis - 7 * DAY_MILLIS);
  const previousWeekEnd = new Date(currentWeekStartMillis - 1);
  return {
    weekStart: previousWeekStart.toISOString(),
    weekEnd: previousWeekEnd.toISOString(),
    weekStartDateOnly: previousWeekStart.toISOString().slice(0, 10),
    weekEndDateOnly: previousWeekEnd.toISOString().slice(0, 10),
  };
}

export function isIsoWithinWindow(value: string, window: WeeklyWindow) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    return false;
  }
  return millis >= Date.parse(window.weekStart) && millis <= Date.parse(window.weekEnd);
}
