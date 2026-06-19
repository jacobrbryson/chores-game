export const DEFAULT_CHORE_COIN_VALUE = 10;
export const MAX_CHORE_COIN_VALUE = 1000;
export const DEFAULT_RECURRENCE_INTERVAL = 2;
export const RECURRENCE_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type ChoreRecurrenceType =
  | "none"
  | "instant"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export type ChoreRecurrenceUnit = "day" | "week" | "month";
export type ChoreRecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number];

export type ChoreRecurrenceConfig = {
  recurrenceType: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  recurrenceDays?: ChoreRecurrenceWeekday[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeCoinValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CHORE_COIN_VALUE;
  }
  const normalized = Math.trunc(parsed);
  return Math.max(0, Math.min(MAX_CHORE_COIN_VALUE, normalized));
}

export function parseCoinValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (!Number.isInteger(parsed)) {
    return null;
  }
  const normalized = parsed;
  if (normalized < 0 || normalized > MAX_CHORE_COIN_VALUE) {
    return null;
  }
  return normalized;
}

export function parseRequireApproval(value: unknown) {
  return value === true;
}

export function parseRecurrenceType(value: unknown): ChoreRecurrenceType {
  if (
    value === "instant" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "custom"
  ) {
    return value;
  }
  return "none";
}

export function parseRecurrenceUnit(value: unknown): ChoreRecurrenceUnit {
  if (value === "week" || value === "month") {
    return value;
  }
  return "day";
}

export function parseRecurrenceInterval(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RECURRENCE_INTERVAL;
  }
  const normalized = Math.trunc(parsed);
  return Math.max(1, Math.min(365, normalized));
}

export function parseRecurrenceDays(value: unknown): ChoreRecurrenceWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<ChoreRecurrenceWeekday>();
  for (const entry of value) {
    if (RECURRENCE_WEEKDAYS.includes(entry as ChoreRecurrenceWeekday)) {
      seen.add(entry as ChoreRecurrenceWeekday);
    }
  }
  return RECURRENCE_WEEKDAYS.filter((day) => seen.has(day));
}

export function normalizeRecurrenceConfig(input: {
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
  recurrenceDays?: unknown;
}): ChoreRecurrenceConfig {
  const recurrenceType = parseRecurrenceType(input.recurrenceType);
  if (recurrenceType !== "custom") {
    return { recurrenceType };
  }
  const recurrenceUnit = parseRecurrenceUnit(input.recurrenceUnit);
  return {
    recurrenceType,
    recurrenceInterval: parseRecurrenceInterval(input.recurrenceInterval),
    recurrenceUnit,
    recurrenceDays: recurrenceUnit === "week" ? parseRecurrenceDays(input.recurrenceDays) : [],
  };
}

export function recurrenceLabel(config: ChoreRecurrenceConfig) {
  if (config.recurrenceType === "none") {
    return "Does not repeat";
  }
  if (config.recurrenceType === "instant") {
    return "Repeats instantly";
  }
  if (config.recurrenceType === "daily") {
    return "Repeats daily";
  }
  if (config.recurrenceType === "weekly") {
    return "Repeats weekly";
  }
  if (config.recurrenceType === "monthly") {
    return "Repeats monthly";
  }
  const interval = Math.max(1, config.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL);
  const unit = config.recurrenceUnit ?? "day";
  if (unit === "week" && config.recurrenceDays?.length) {
    const dayLabel = recurrenceDaysLabel(config.recurrenceDays);
    return interval === 1
      ? `Repeats every ${dayLabel}`
      : `Repeats every ${interval} weeks on ${dayLabel}`;
  }
  const unitLabel =
    interval === 1
      ? unit
      : `${unit}${unit === "day" ? "s" : unit === "week" ? "s" : "s"}`;
  return `Repeats every ${interval} ${unitLabel}`;
}

// Compact recurrence summary for dense UI (dashboard chore rows). Unlike
// `recurrenceLabel` ("Repeats weekly") this returns just the cadence
// ("Weekly", "Every 2 weeks", "Custom") so it fits inline next to a chore.
export function recurrenceShortLabel(config: ChoreRecurrenceConfig) {
  if (config.recurrenceType === "none") {
    return "";
  }
  if (config.recurrenceType === "instant") {
    return "Instant";
  }
  if (config.recurrenceType === "daily") {
    return "Daily";
  }
  if (config.recurrenceType === "weekly") {
    return "Weekly";
  }
  if (config.recurrenceType === "monthly") {
    return "Monthly";
  }
  const interval = Math.max(1, config.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL);
  const unit = config.recurrenceUnit ?? "day";
  if (unit === "week" && config.recurrenceDays?.length) {
    const dayLabel = recurrenceDaysLabel(config.recurrenceDays);
    return interval === 1 ? `Every ${dayLabel}` : `Every ${interval} weeks on ${dayLabel}`;
  }
  if (interval === 1) {
    return unit === "day" ? "Daily" : unit === "week" ? "Weekly" : "Monthly";
  }
  const unitLabel = unit === "day" ? "days" : unit === "week" ? "weeks" : "months";
  return `Every ${interval} ${unitLabel}`;
}

const WEEKDAY_LONG_LABELS: Record<ChoreRecurrenceWeekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

export function recurrenceDaysLabel(days: ChoreRecurrenceWeekday[]) {
  const normalized = parseRecurrenceDays(days);
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length === 7) {
    return "day";
  }
  if (normalized.length === 1) {
    return WEEKDAY_LONG_LABELS[normalized[0] ?? "sun"];
  }
  if (normalized.length === 2) {
    return normalized.map((day) => WEEKDAY_LONG_LABELS[day]).join(" and ");
  }
  const labels = normalized.map((day) => WEEKDAY_LONG_LABELS[day]);
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function addMonths(baseDate: Date, months: number) {
  const nextDate = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 1));
  nextDate.setUTCMonth(nextDate.getUTCMonth() + months);
  const targetDay = baseDate.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  nextDate.setUTCDate(Math.min(targetDay, lastDayOfMonth));
  return nextDate;
}

function toUtcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(baseDate: Date, days: number) {
  return new Date(baseDate.getTime() + days * MS_PER_DAY);
}

function startOfUtcWeek(baseDate: Date) {
  const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function nextWeeklyDayDueDate(baseDate: Date, interval: number, days: ChoreRecurrenceWeekday[]) {
  const dayIndexes = parseRecurrenceDays(days).map((day) => RECURRENCE_WEEKDAYS.indexOf(day));
  if (dayIndexes.length === 0) {
    return addDays(baseDate, interval * 7);
  }
  const currentDay = baseDate.getUTCDay();
  const nextSameWeekDay = dayIndexes.find((dayIndex) => dayIndex > currentDay);
  if (nextSameWeekDay !== undefined) {
    const weekStart = startOfUtcWeek(baseDate);
    return addDays(weekStart, nextSameWeekDay);
  }
  const weekStart = startOfUtcWeek(baseDate);
  return addDays(weekStart, interval * 7 + dayIndexes[0]);
}

export function nextRecurringDueDate(
  dueDate: string,
  config: ChoreRecurrenceConfig,
  fallbackToday: string,
) {
  if (config.recurrenceType === "none") {
    return "";
  }
  if (config.recurrenceType === "instant") {
    return fallbackToday;
  }

  const baseDate = toUtcDate(dueDate) ?? toUtcDate(fallbackToday);
  if (!baseDate) {
    return fallbackToday;
  }

  let nextDate = new Date(baseDate);
  if (config.recurrenceType === "daily") {
    nextDate = new Date(baseDate.getTime() + MS_PER_DAY);
  } else if (config.recurrenceType === "weekly") {
    nextDate = new Date(baseDate.getTime() + 7 * MS_PER_DAY);
  } else if (config.recurrenceType === "monthly") {
    nextDate = addMonths(baseDate, 1);
  } else {
    const interval = Math.max(1, config.recurrenceInterval ?? DEFAULT_RECURRENCE_INTERVAL);
    const unit = config.recurrenceUnit ?? "day";
    if (unit === "day") {
      nextDate = addDays(baseDate, interval);
    } else if (unit === "week") {
      nextDate = nextWeeklyDayDueDate(baseDate, interval, config.recurrenceDays ?? []);
    } else {
      nextDate = addMonths(baseDate, interval);
    }
  }

  return nextDate.toISOString().slice(0, 10);
}
