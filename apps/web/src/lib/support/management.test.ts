import { describe, expect, it } from "vitest";
import {
  filterSupportRequests,
  paginateSupportRequests,
  sortSupportRequests,
  summarizeSupportRequests,
  type SupportRequestListRecord,
} from "@/lib/support/management";

const records: SupportRequestListRecord[] = [
  {
    id: "1",
    familyId: "fam-1",
    familyName: "Alpha",
    type: "bug",
    subject: "Crash on chores page",
    descriptionPreview: "Crash on chores page",
    status: "new",
    severity: "high",
    createdByUid: "u1",
    createdByDisplayName: "A",
    createdByEmail: "a@example.com",
    pageUrl: "/chores",
    createdAt: "2026-05-31T10:00:00.000Z",
    updatedAt: "2026-05-31T10:00:00.000Z",
  },
  {
    id: "2",
    familyId: "fam-2",
    familyName: "Beta",
    type: "feature",
    subject: "Need reminders",
    descriptionPreview: "Need reminders",
    status: "done",
    severity: null,
    createdByUid: "u2",
    createdByDisplayName: "B",
    createdByEmail: "b@example.com",
    pageUrl: "/profile",
    createdAt: "2026-05-20T10:00:00.000Z",
    updatedAt: "2026-05-28T10:00:00.000Z",
  },
];

describe("support management helpers", () => {
  it("filters by type, status, severity, and search", () => {
    expect(filterSupportRequests(records, { type: "bug" })).toHaveLength(1);
    expect(filterSupportRequests(records, { status: "done" })).toHaveLength(1);
    expect(filterSupportRequests(records, { severity: "high" })).toHaveLength(1);
    expect(filterSupportRequests(records, { q: "reminders" })).toHaveLength(1);
  });

  it("sorts by severity and paginates", () => {
    const sorted = sortSupportRequests(records, { sortBy: "severity", sortDir: "asc" });
    expect(sorted[0]?.id).toBe("1");
    const paged = paginateSupportRequests(sorted, { page: 2, limit: 1 });
    expect(paged.records[0]?.id).toBe("2");
    expect(paged.pagination.totalPages).toBe(2);
  });

  it("summarizes status, type, and close timing", () => {
    const summary = summarizeSupportRequests(records);
    expect(summary.total).toBe(2);
    expect(summary.byStatus.new).toBe(1);
    expect(summary.byStatus.done).toBe(1);
    expect(summary.byType.bug).toBe(1);
    expect(summary.byType.feature).toBe(1);
    expect(summary.highSeverityBugs).toBe(1);
    expect(summary.averageHoursToClose).not.toBeNull();
  });
});
