export const DEFAULT_CHORE_COIN_VALUE = 10;
export const MAX_CHORE_COIN_VALUE = 1000;
export const DEFAULT_RECURRENCE_INTERVAL = 2;

export type ChoreRecurrenceType =
  | "none"
  | "instant"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export type ChoreRecurrenceUnit = "day" | "week" | "month";

export type ChoreRecurrenceConfig = {
  recurrenceType: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
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

export function normalizeRecurrenceConfig(input: {
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
}): ChoreRecurrenceConfig {
  const recurrenceType = parseRecurrenceType(input.recurrenceType);
  if (recurrenceType !== "custom") {
    return { recurrenceType };
  }
  return {
    recurrenceType,
    recurrenceInterval: parseRecurrenceInterval(input.recurrenceInterval),
    recurrenceUnit: parseRecurrenceUnit(input.recurrenceUnit),
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
  const unitLabel =
    interval === 1
      ? unit
      : `${unit}${unit === "day" ? "s" : unit === "week" ? "s" : "s"}`;
  return `Repeats every ${interval} ${unitLabel}`;
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
      nextDate = new Date(baseDate.getTime() + interval * MS_PER_DAY);
    } else if (unit === "week") {
      nextDate = new Date(baseDate.getTime() + interval * 7 * MS_PER_DAY);
    } else {
      nextDate = addMonths(baseDate, interval);
    }
  }

  return nextDate.toISOString().slice(0, 10);
}
