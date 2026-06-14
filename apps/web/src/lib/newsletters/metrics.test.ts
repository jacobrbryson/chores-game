import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeWeeklyFamilyHighlightMetrics,
  getRecipientSkipReason,
  loadNewsletterFamilyContext,
} from "@/lib/newsletters/metrics";

const { mockAdminGetDocument, mockAdminListDocuments, mockAdminListAllDocuments } = vi.hoisted(
  () => ({
    mockAdminGetDocument: vi.fn(),
    mockAdminListDocuments: vi.fn(),
    mockAdminListAllDocuments: vi.fn(),
  }),
);

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mockAdminGetDocument,
  adminListDocuments: mockAdminListDocuments,
  adminListAllDocuments: mockAdminListAllDocuments,
}));

function doc(name: string, fields: Record<string, unknown>) {
  return { name, fields } as any;
}

function stringValue(value: string) {
  return { stringValue: value };
}

function booleanValue(value: boolean) {
  return { booleanValue: value };
}

function integerValue(value: number) {
  return { integerValue: String(value) };
}

describe("newsletter metrics and recipients", () => {
  beforeEach(() => {
    mockAdminGetDocument.mockReset();
    mockAdminListDocuments.mockReset();
    mockAdminListAllDocuments.mockReset();
  });

  it("includes admins, excludes players by default, and identifies skip reasons", async () => {
    mockAdminGetDocument.mockImplementation(async (path: string) => {
      if (path === "families/family-1") {
        return doc(path, { name: stringValue("Rivera"), defaultLocale: stringValue("en-US") });
      }
      if (path === "users/admin-1") {
        return doc(path, {
          email: stringValue("parent@example.com"),
          locale: stringValue("en-US"),
          weeklyFamilyHighlightsEmail: booleanValue(true),
          name: stringValue("Parent"),
        });
      }
      if (path === "users/admin-2") {
        return doc(path, {
          email: stringValue(""),
          locale: stringValue("en-US"),
          name: stringValue("Second Parent"),
        });
      }
      throw new Error(`Unexpected path ${path}`);
    });
    mockAdminListDocuments.mockResolvedValue([
      doc("families/family-1/members/admin-1", {
        role: stringValue("admin"),
        status: stringValue("active"),
        uid: stringValue("admin-1"),
        email: stringValue("parent@example.com"),
        name: stringValue("Parent"),
      }),
      doc("families/family-1/members/admin-2", {
        role: stringValue("admin"),
        status: stringValue("active"),
        uid: stringValue("admin-2"),
        email: stringValue(""),
        name: stringValue("Second Parent"),
      }),
      doc("families/family-1/members/player-1", {
        role: stringValue("player"),
        status: stringValue("active"),
        uid: stringValue("player-1"),
        email: stringValue("kid@example.com"),
        name: stringValue("Kid"),
      }),
    ]);

    const context = await loadNewsletterFamilyContext("family-1");

    expect(context.recipients.map((entry) => entry.uid)).toEqual(["admin-1", "admin-2"]);
    expect(getRecipientSkipReason(context.recipients[0])).toBe("");
    expect(context.recipients[1]?.optedIn).toBe(true);
    expect(getRecipientSkipReason(context.recipients[1])).toBe("invalid_email");
  });

  it("aggregates weekly counts from chores, ledger, rewards, quests, achievements, and pending approvals", async () => {
    // members is read via adminListDocuments; the unbounded collections (chores,
    // notifications, awardClaims, walletLedger, ...) are paged via
    // adminListAllDocuments. Both resolve from the same path-keyed fixtures.
    const listByPath = async (path: string) => {
      if (path === "families/family-1/members") {
        return [
          doc(`${path}/player-1`, {
            role: stringValue("player"),
            status: stringValue("active"),
            uid: stringValue("player-1"),
            email: stringValue("ava@example.com"),
            name: stringValue("Ava"),
          }),
          doc(`${path}/player-2`, {
            role: stringValue("player"),
            status: stringValue("active"),
            uid: stringValue("player-2"),
            email: stringValue("bo@example.com"),
            name: stringValue("Bo"),
          }),
        ];
      }
      if (path === "families/family-1/chores") {
        return [
          doc(`${path}/chore-1`, {
            status: stringValue("Approved"),
            assigneeId: stringValue("player-1"),
            submittedAt: stringValue("2026-06-02T10:00:00.000Z"),
          }),
          doc(`${path}/chore-2`, {
            status: stringValue("Submitted"),
            assigneeId: stringValue("player-1"),
            submittedAt: stringValue("2026-06-03T10:00:00.000Z"),
          }),
          // Family-scoped chore: credits every member, mirroring the dashboard
          // leaderboard. The old metric ignored this entirely.
          doc(`${path}/chore-3`, {
            status: stringValue("Approved"),
            assigneeScope: stringValue("family"),
            submittedAt: stringValue("2026-06-04T10:00:00.000Z"),
          }),
        ];
      }
      if (path === "families/family-1/notifications") {
        return [
          doc(`${path}/n1`, {
            title: stringValue("Chore approved"),
            message: stringValue("Ava finished dishes."),
            createdAt: stringValue("2026-06-03T12:00:00.000Z"),
          }),
        ];
      }
      if (path === "families/family-1/awardClaims") {
        return [
          doc(`${path}/a1`, {
            purchasedAt: stringValue("2026-06-03T11:00:00.000Z"),
            status: stringValue("claimed"),
            claimedAt: stringValue("2026-06-04T11:00:00.000Z"),
          }),
        ];
      }
      if (path === "users/player-1/walletLedger") {
        return [
          doc(`${path}/l1`, {
            countsTowardBalance: booleanValue(true),
            delta: integerValue(15),
            createdAt: stringValue("2026-06-03T10:30:00.000Z"),
          }),
        ];
      }
      if (path === "users/player-1/questProgress") {
        return [
          doc(`${path}/q1`, {
            status: stringValue("completed"),
            completedAt: stringValue("2026-06-03T13:00:00.000Z"),
          }),
        ];
      }
      if (path === "users/player-1/achievements") {
        return [
          doc(`${path}/ach-1`, {
            completed: booleanValue(true),
            completedAt: stringValue("2026-06-05T13:00:00.000Z"),
          }),
        ];
      }
      return [];
    };
    mockAdminListDocuments.mockImplementation(listByPath);
    mockAdminListAllDocuments.mockImplementation(listByPath);
    const metrics = await computeWeeklyFamilyHighlightMetrics({
      familyId: "family-1",
      recipientUids: ["player-1"],
      window: {
        weekStart: "2026-06-02T00:00:00.000Z",
        weekEnd: "2026-06-08T23:59:59.999Z",
        weekStartDateOnly: "2026-06-02",
        weekEndDateOnly: "2026-06-08",
      },
    });

    expect(metrics.choresCompleted).toBe(3);
    expect(metrics.coinsEarned).toBe(15);
    expect(metrics.rewardsRedeemed).toBe(1);
    expect(metrics.familyAwardsClaimed).toBe(1);
    expect(metrics.questsCompleted).toBe(1);
    expect(metrics.achievementsUnlocked).toBe(1);
    expect(metrics.pendingApprovals).toBe(1);
    // Ava is credited for 2 single-assignee chores + the family-scoped chore.
    expect(metrics.mostActiveHelperName).toBe("Ava");
    expect(metrics.mostActiveHelperCount).toBe(3);
    expect(metrics.recentHighlights).toHaveLength(1);
  });
});
