import { describe, expect, it } from "vitest";
import { CHANGE_LOG_ENTRY_TYPES, getChangeLogEntries } from "@/lib/change-log";

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
});
