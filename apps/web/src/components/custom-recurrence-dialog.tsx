"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import {
  RECURRENCE_WEEKDAYS,
  type ChoreRecurrenceWeekday,
  type ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";

const CUSTOM_RECURRENCE_DEFAULT_INTERVAL = 1;

type CustomRecurrenceDialogProps = {
  open: boolean;
  interval: string;
  unit: ChoreRecurrenceUnit;
  days: ChoreRecurrenceWeekday[];
  anchorDate?: string;
  onCancel: () => void;
  onSave: (next: {
    interval: string;
    unit: ChoreRecurrenceUnit;
    days: ChoreRecurrenceWeekday[];
  }) => void;
};

export function customRecurrenceSummary(
  intervalValue: string | number | undefined,
  unit: ChoreRecurrenceUnit | undefined,
  days: ChoreRecurrenceWeekday[] | undefined,
  t: (key: string, params?: Record<string, string>) => string,
) {
  const parsed = Number(intervalValue);
  const interval = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : CUSTOM_RECURRENCE_DEFAULT_INTERVAL;
  const resolvedUnit = unit ?? "day";
  const selectedDays = normalizeRecurrenceDays(days ?? []);
  if (resolvedUnit === "week" && selectedDays.length > 0) {
    const dayLabel = recurrenceDaysSummary(selectedDays, t);
    return interval === 1
      ? t("chores.recurrence.everyWeekdaySummary", { days: dayLabel })
      : t("chores.recurrence.everyIntervalWeeksOnSummary", {
          count: String(interval),
          days: dayLabel,
        });
  }
  if (interval === 1) {
    return resolvedUnit === "day"
      ? t("chores.recurrence.daily")
      : resolvedUnit === "week"
        ? t("chores.recurrence.weekly")
        : t("chores.recurrence.monthly");
  }
  const unitLabel =
    resolvedUnit === "day"
      ? t("chores.recurrence.unitDays").toLowerCase()
      : resolvedUnit === "week"
        ? t("chores.recurrence.unitWeeks").toLowerCase()
        : t("chores.recurrence.unitMonths").toLowerCase();
  return t("chores.recurrence.everySummary", {
    count: String(interval),
    unit: unitLabel,
  });
}

function isSingularInterval(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) === 1;
}

function normalizeIntervalInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) {
    return String(CUSTOM_RECURRENCE_DEFAULT_INTERVAL);
  }
  return String(Math.max(1, Math.min(365, Math.trunc(parsed))));
}

const WEEKDAY_LABEL_KEYS: Record<ChoreRecurrenceWeekday, string> = {
  sun: "chores.recurrence.weekdays.sun",
  mon: "chores.recurrence.weekdays.mon",
  tue: "chores.recurrence.weekdays.tue",
  wed: "chores.recurrence.weekdays.wed",
  thu: "chores.recurrence.weekdays.thu",
  fri: "chores.recurrence.weekdays.fri",
  sat: "chores.recurrence.weekdays.sat",
};

const WEEKDAY_SHORT_LABEL_KEYS: Record<ChoreRecurrenceWeekday, string> = {
  sun: "chores.recurrence.weekdaysShort.sun",
  mon: "chores.recurrence.weekdaysShort.mon",
  tue: "chores.recurrence.weekdaysShort.tue",
  wed: "chores.recurrence.weekdaysShort.wed",
  thu: "chores.recurrence.weekdaysShort.thu",
  fri: "chores.recurrence.weekdaysShort.fri",
  sat: "chores.recurrence.weekdaysShort.sat",
};

function normalizeRecurrenceDays(days: ChoreRecurrenceWeekday[]) {
  const selected = new Set(days);
  return RECURRENCE_WEEKDAYS.filter((day) => selected.has(day));
}

function recurrenceDaysSummary(
  days: ChoreRecurrenceWeekday[],
  t: (key: string, params?: Record<string, string>) => string,
) {
  const normalized = normalizeRecurrenceDays(days);
  if (normalized.length === 7) {
    return t("chores.recurrence.daysLabel");
  }
  return normalized.map((day) => t(WEEKDAY_LABEL_KEYS[day])).join(", ");
}

function weekdayFromDate(value: string | undefined): ChoreRecurrenceWeekday {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return RECURRENCE_WEEKDAYS[parsed.getUTCDay()] ?? "sun";
    }
  }
  return RECURRENCE_WEEKDAYS[new Date().getDay()] ?? "sun";
}

export function CustomRecurrenceDialog({
  open,
  interval,
  unit,
  days,
  anchorDate,
  onCancel,
  onSave,
}: CustomRecurrenceDialogProps) {
  const { t } = useLocale();
  const [draftInterval, setDraftInterval] = useState(interval || String(CUSTOM_RECURRENCE_DEFAULT_INTERVAL));
  const [draftUnit, setDraftUnit] = useState<ChoreRecurrenceUnit>(unit || "day");
  const [draftDays, setDraftDays] = useState<ChoreRecurrenceWeekday[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftInterval(interval || String(CUSTOM_RECURRENCE_DEFAULT_INTERVAL));
    setDraftUnit(unit || "day");
    setDraftDays(normalizeRecurrenceDays(days).length ? normalizeRecurrenceDays(days) : [weekdayFromDate(anchorDate)]);
  }, [anchorDate, days, interval, open, unit]);

  const unitOptions = useMemo<TailwindSelectOption<ChoreRecurrenceUnit>[]>(
    () => [
      { value: "day", label: t(isSingularInterval(draftInterval) ? "chores.recurrence.unitDay" : "chores.recurrence.unitDays") },
      { value: "week", label: t(isSingularInterval(draftInterval) ? "chores.recurrence.unitWeek" : "chores.recurrence.unitWeeks") },
      { value: "month", label: t(isSingularInterval(draftInterval) ? "chores.recurrence.unitMonth" : "chores.recurrence.unitMonths") },
    ],
    [draftInterval, t],
  );

  function save() {
    const parsed = Number(draftInterval);
    const normalized = Number.isFinite(parsed)
      ? Math.max(1, Math.min(365, Math.trunc(parsed)))
      : CUSTOM_RECURRENCE_DEFAULT_INTERVAL;
    onSave({
      interval: String(normalized),
      unit: draftUnit,
      days: draftUnit === "week" ? draftDays : [],
    });
  }

  function toggleDay(day: ChoreRecurrenceWeekday) {
    setDraftDays((current) => {
      if (current.includes(day)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== day);
      }
      return normalizeRecurrenceDays([...current, day]);
    });
  }

  return (
    <ModalShell open={open} onRequestClose={onCancel}>
      <section className="w-[min(92vw,28rem)] rounded-2xl bg-white p-6 text-slate-800 shadow-xl">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t("chores.recurrence.customTitle")}
        </h2>

        <div className="mt-6 flex flex-nowrap items-center gap-3">
          <span className="shrink-0 text-sm font-medium text-slate-700">
            {t("chores.recurrence.repeatEvery")}
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draftInterval}
            aria-label={t("chores.recurrence.intervalLabel")}
            onBlur={() => {
              if (!draftInterval) {
                setDraftInterval(String(CUSTOM_RECURRENCE_DEFAULT_INTERVAL));
              }
            }}
            onChange={(event) => setDraftInterval(normalizeIntervalInput(event.target.value))}
            className="h-11 w-20 shrink-0 rounded-md border border-slate-300 px-3 text-slate-900"
          />
          <TailwindSelect
            ariaLabel={t("chores.recurrence.unitLabel")}
            value={draftUnit}
            onChange={(value) => setDraftUnit(value)}
            options={unitOptions}
            className="min-w-0 flex-1"
            buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            menuClassName="border-slate-300"
          />
        </div>

        {draftUnit === "week" ? (
          <div className="mt-6">
            <span className="text-sm font-medium text-slate-700">
              {t("chores.recurrence.repeatOn")}
            </span>
            <div className="mt-3 flex flex-wrap gap-2">
              {RECURRENCE_WEEKDAYS.map((day) => {
                const selected = draftDays.includes(day);
                return (
                  <Button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    title={t(WEEKDAY_LABEL_KEYS[day])}
                    className={`h-9 w-9 rounded-full text-sm font-semibold ${
                      selected
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                    onClick={() => toggleDay(day)}>
                    {t(WEEKDAY_SHORT_LABEL_KEYS[day])}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-sm font-medium text-slate-500">
          {customRecurrenceSummary(draftInterval, draftUnit, draftDays, t)}
        </p>

        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t("common.actions.cancel")}
          </Button>
          <Button type="button" className="btn btn-primary" onClick={save}>
            {t("common.actions.done")}
          </Button>
        </div>
      </section>
    </ModalShell>
  );
}
