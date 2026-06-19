import { describe, expect, it } from "vitest";
import { nextRecurringDueDate, recurrenceShortLabel } from "./recurrence";

describe("recurrenceShortLabel", () => {
  it("returns an empty string for non-recurring chores", () => {
    expect(recurrenceShortLabel({ recurrenceType: "none" })).toBe("");
  });

  it("labels the simple cadences", () => {
    expect(recurrenceShortLabel({ recurrenceType: "daily" })).toBe("Daily");
    expect(recurrenceShortLabel({ recurrenceType: "weekly" })).toBe("Weekly");
    expect(recurrenceShortLabel({ recurrenceType: "monthly" })).toBe("Monthly");
    expect(recurrenceShortLabel({ recurrenceType: "instant" })).toBe("Instant");
  });

  it("summarizes custom intervals compactly", () => {
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 2,
        recurrenceUnit: "week",
      }),
    ).toBe("Every 2 weeks");
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 3,
        recurrenceUnit: "day",
      }),
    ).toBe("Every 3 days");
  });

  it("collapses single-interval custom recurrences to the base cadence", () => {
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 1,
        recurrenceUnit: "week",
      }),
    ).toBe("Weekly");
  });

  it("summarizes weekly custom recurrences with selected weekdays", () => {
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 1,
        recurrenceUnit: "week",
        recurrenceDays: ["tue"],
      }),
    ).toBe("Every Tuesday");
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 2,
        recurrenceUnit: "week",
        recurrenceDays: ["tue"],
      }),
    ).toBe("Every 2 weeks on Tuesday");
    expect(
      recurrenceShortLabel({
        recurrenceType: "custom",
        recurrenceInterval: 1,
        recurrenceUnit: "week",
        recurrenceDays: ["mon", "tue", "wed", "thu", "fri"],
      }),
    ).toBe("Every Monday, Tuesday, Wednesday, Thursday, and Friday");
  });
});

describe("nextRecurringDueDate", () => {
  it("schedules the next selected weekday", () => {
    expect(
      nextRecurringDueDate(
        "2026-06-15",
        {
          recurrenceType: "custom",
          recurrenceInterval: 1,
          recurrenceUnit: "week",
          recurrenceDays: ["tue"],
        },
        "2026-06-15",
      ),
    ).toBe("2026-06-16");
  });

  it("continues through selected weekdays in the same week", () => {
    expect(
      nextRecurringDueDate(
        "2026-06-15",
        {
          recurrenceType: "custom",
          recurrenceInterval: 1,
          recurrenceUnit: "week",
          recurrenceDays: ["mon", "tue", "wed", "thu", "fri"],
        },
        "2026-06-15",
      ),
    ).toBe("2026-06-16");
  });

  it("advances by interval weeks after the last selected weekday", () => {
    expect(
      nextRecurringDueDate(
        "2026-06-16",
        {
          recurrenceType: "custom",
          recurrenceInterval: 2,
          recurrenceUnit: "week",
          recurrenceDays: ["tue"],
        },
        "2026-06-16",
      ),
    ).toBe("2026-06-30");
  });
});
