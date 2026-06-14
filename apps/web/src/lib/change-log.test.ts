import { describe, expect, it } from "vitest";
import { CHANGE_LOG_ENTRY_TYPES, getChangeLogEntries, getChangeLogEntryGroup, getChangeLogEntryGroups } from "@/lib/change-log";

describe("change log data", () => {
  it("contains valid entries with required fields", () => {
    const entries = getChangeLogEntries();

    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.id).toBeTruthy();
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(CHANGE_LOG_ENTRY_TYPES).toContain(entry.type);
      expect(entry.subject).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.image).toMatch(/^\//);
    }
  });

  it("sorts entries newest first", () => {
    const entries = getChangeLogEntries();

    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      expect(previous.date.localeCompare(current.date)).toBeGreaterThanOrEqual(0);
    }
  });

  it("groups entries by date with feature and bug-fix buckets", () => {
    const groups = getChangeLogEntryGroups();

    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      expect(group.entries.length).toBeGreaterThan(0);
      expect(group.slug).toBeTruthy();
      expect(group.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(group.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(group.entries.every((entry) => entry.date >= group.startDate && entry.date <= group.endDate)).toBe(true);
      expect(group.features.every((entry) => entry.type === "Feature")).toBe(true);
      expect(group.bugFixes.every((entry) => entry.type === "Bug Fix")).toBe(true);
    }
  });

  it("combines June 11 through June 14 into one public group", () => {
    const group = getChangeLogEntryGroup("2026-06-14");

    expect(group?.startDate).toBe("2026-06-11");
    expect(group?.endDate).toBe("2026-06-14");
    expect(group?.entries.length).toBeGreaterThan(1);
    expect(group?.entries.every((entry) => entry.date >= "2026-06-11" && entry.date <= "2026-06-14")).toBe(true);
  });

  it("returns a single date group when requested", () => {
    const firstEntry = getChangeLogEntries()[0];
    expect(firstEntry).toBeTruthy();

    const group = getChangeLogEntryGroup(firstEntry.date);
    expect(group).toBeTruthy();
    expect(group!.startDate <= firstEntry.date).toBe(true);
    expect(group!.endDate >= firstEntry.date).toBe(true);
    expect(group!.entries.some((entry) => entry.id === firstEntry.id)).toBe(true);
  });
});
