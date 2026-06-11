import { describe, expect, it } from "vitest";
import { recurrenceShortLabel } from "./recurrence";

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
});
