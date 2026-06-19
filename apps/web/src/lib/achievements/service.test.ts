import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateOrReplaceDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockListAllDocuments = vi.fn();
const mockPublishAchievementUnlocked = vi.fn();

const achievementDocs = new Map<string, Record<string, unknown>>();
let achievementStateDoc: Record<string, unknown> | null = null;
let choreDocs: Array<{ name: string; fields: Record<string, unknown> }> = [];

type ArrayFieldValue = { arrayValue?: { values?: Array<{ stringValue?: string }> } };

vi.mock("@/lib/firestore/rest", () => ({
  createOrReplaceDocument: mockCreateOrReplaceDocument,
  getDocument: mockGetDocument,
  listDocuments: mockListDocuments,
  listAllDocuments: mockListAllDocuments,
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  integerField: (value: number) => value,
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) =>
    Boolean(fields?.[key]),
  readInteger: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "number" ? Number(fields[key]) : 0,
  readString: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "string" ? String(fields[key]) : "",
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    const wrapped = value as ArrayFieldValue | undefined;
    if (wrapped && typeof wrapped === "object" && wrapped.arrayValue) {
      return (wrapped.arrayValue.values ?? [])
        .map((entry) => entry.stringValue)
        .filter((entry): entry is string => typeof entry === "string");
    }
    return [];
  },
  stringField: (value: string) => value,
  timestampField: (value: string) => value,
}));

vi.mock("@/lib/ws/publish-achievement-unlocked", () => ({
  publishAchievementUnlocked: mockPublishAchievementUnlocked,
}));

describe("achievement service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    achievementDocs.clear();
    achievementStateDoc = null;
    choreDocs = [];

    mockListAllDocuments.mockImplementation(async (path: string) => {
      if (path === "families/fam-1/chores") {
        return choreDocs;
      }
      return [];
    });

    mockListDocuments.mockImplementation(async (path: string) => {
      if (path === "users/player-1/achievements") {
        return Array.from(achievementDocs.entries()).map(([id, fields]) => ({
          name: `projects/test/databases/(default)/documents/users/player-1/achievements/${id}`,
          fields,
        }));
      }
      if (path === "families/fam-1/members") {
        return [
          {
            name: "projects/test/databases/(default)/documents/families/fam-1/members/player-1",
            fields: { uid: "player-1", deleted: false, email: "player@example.com" },
          },
        ];
      }
      if (path === "families/fam-1/chores") {
        return [];
      }
      return [];
    });

    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/player-1/achievementState/state") {
        if (!achievementStateDoc) {
          throw new Error("FIRESTORE_HTTP_404");
        }
        return { fields: achievementStateDoc };
      }
      if (path === "users/player-1") {
        return { fields: { locale: "es-US" } };
      }
      if (path === "families/fam-1") {
        return { fields: { defaultLocale: "en-US" } };
      }
      throw new Error(`UNEXPECTED_GET_${path}`);
    });

    mockCreateOrReplaceDocument.mockImplementation(async (path: string, fields: Record<string, unknown>) => {
      if (path.startsWith("users/player-1/achievements/")) {
        achievementDocs.set(path.split("/").pop() ?? "", fields);
        return;
      }
      if (path === "users/player-1/achievementState/state") {
        achievementStateDoc = fields;
        return;
      }
      return;
    });
  });

  it("increments progress, caps at target, and publishes unlock once for duplicate event id", async () => {
    const { trackAchievementEvent } = await import("./service");
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-1",
      metricDeltas: { chores_completed: 1 },
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-1",
      metricDeltas: { chores_completed: 1 },
    });
    const firstChoreDoc = achievementDocs.get("player_first_chore");
    expect(firstChoreDoc?.progress).toBe(1);
    expect(firstChoreDoc?.percentComplete).toBe(100);
    expect(mockPublishAchievementUnlocked).toHaveBeenCalledTimes(1);
  });

  it("does not grant admin-only achievement progress to player role", async () => {
    const { trackAchievementEvent } = await import("./service");
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-admin",
      metricDeltas: { admin_chores_created: 3 },
    });
    expect(achievementDocs.has("admin_first_chore_created")).toBe(false);
  });

  it("unlocks representative domain achievements", async () => {
    const { trackAchievementEvent } = await import("./service");
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-chore-complete",
      metricDeltas: { chores_completed: 1 },
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-approval",
      metricDeltas: { chores_approved: 1, coins_earned: 5 },
      approvalStreakDelta: "increment",
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-store",
      metricDeltas: { store_purchases: 1 },
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-reward",
      metricDeltas: { family_awards_redeemed: 1 },
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "admin",
      eventId: "evt-admin-create",
      metricDeltas: { admin_chores_created: 1 },
    });
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "admin",
      eventId: "evt-admin-approve",
      metricDeltas: { admin_chores_approved: 1 },
    });

    expect((achievementDocs.get("player_first_chore")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("player_first_approval")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("player_first_coin")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("player_first_purchase")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("player_first_reward")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("admin_first_chore_created")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
    expect((achievementDocs.get("admin_first_approval")?.completed as { booleanValue: boolean }).booleanValue).toBe(true);
  });

  it("returns admin achievements as locked/restricted for player viewers", async () => {
    achievementDocs.set("admin_first_chore_created", {
      achievementId: "admin_first_chore_created",
      progress: 1,
      target: 1,
      percentComplete: 100,
      completed: true,
      completedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastEventId: "evt",
    });
    const { getAchievementViewForUser } = await import("./service");
    const response = await getAchievementViewForUser({
      uid: "player-1",
      idToken: "token",
      viewerRole: "player",
      locale: "en-US",
    });
    const adminEntry = response.find((entry) => entry.id === "admin_first_chore_created");
    expect(adminEntry?.restricted).toBe(true);
    expect(adminEntry?.locked).toBe(true);
    expect(adminEntry?.progress).toBe(0);
    expect(adminEntry?.percentComplete).toBe(0);
    expect(adminEntry?.completed).toBe(false);
  });

  it("returns localized achievement copy for the requested locale", async () => {
    const { getAchievementViewForUser } = await import("./service");
    const response = await getAchievementViewForUser({
      uid: "player-1",
      idToken: "token",
      viewerRole: "player",
      locale: "es-US",
    });
    const firstEntry = response.find((entry) => entry.id === "player_first_chore");
    expect(firstEntry?.title).toBe("Primera tarea completada");
    expect(firstEntry?.wittyTitle).toBe("Tarea pequena, leyenda enorme");
    expect(firstEntry?.description).toBe("Completa tu primera tarea.");
  });

  it("publishes unlock notifications using the resolved locale", async () => {
    const { trackAchievementEvent } = await import("./service");
    await trackAchievementEvent({
      uid: "player-1",
      familyId: "fam-1",
      idToken: "token",
      viewerRole: "player",
      eventId: "evt-localized",
      metricDeltas: { chores_completed: 1 },
    });
    expect(mockPublishAchievementUnlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        achievementId: "player_first_chore",
        title: "Primera tarea completada",
        wittyTitle: "Tarea pequena, leyenda enorme",
        description: "Completa tu primera tarea.",
      }),
    );
  });

  it("counts family-scope and multi-assignee chores in completion-derived maximums", async () => {
    // Group, family, and multi-assignee chores persist an empty singular
    // assigneeId, so matching only on that field would leave these metrics at 0.
    choreDocs = [
      {
        name: "families/fam-1/chores/family-chore",
        fields: {
          status: "Approved",
          submittedAt: "2026-06-17T09:00:00.000Z",
          assigneeScope: "family",
          assigneeId: "",
          assigneeIds: [],
          categoryIds: { arrayValue: { values: [{ stringValue: "cat-kitchen" }] } },
        },
      },
      {
        name: "families/fam-1/chores/group-chore",
        fields: {
          status: "Submitted",
          submittedAt: "2026-06-17T18:00:00.000Z",
          assigneeScope: "multiple",
          assigneeId: "",
          assigneeIds: ["player-1", "player-2"],
          categoryIds: { arrayValue: { values: [{ stringValue: "cat-yard" }] } },
        },
      },
      {
        name: "families/fam-1/chores/other-player-chore",
        fields: {
          status: "Approved",
          submittedAt: "2026-06-17T10:00:00.000Z",
          assigneeScope: "single",
          assigneeId: "player-2",
          assigneeIds: ["player-2"],
          categoryIds: { arrayValue: { values: [{ stringValue: "cat-misc" }] } },
        },
      },
    ];

    const { computeCompletionDerivedMaximums } = await import("./service");
    const result = await computeCompletionDerivedMaximums({
      familyId: "fam-1",
      uid: "player-1",
      idToken: "token",
      completedAtIso: "2026-06-17T18:00:00.000Z",
    });

    // player-1 owns the family chore (every member) and the group chore (in the
    // assigneeIds array), but not the chore assigned solely to player-2.
    expect(result.chores_completed_single_day).toBe(2);
    expect(result.chores_completed_single_week).toBe(2);
    expect(result.daily_completion_streak).toBe(1);
    expect(result.distinct_categories_completed).toBe(2);
  });
});
