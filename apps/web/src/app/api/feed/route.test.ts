import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockRunQuery = vi.fn();
const mockListFamilyFriends = vi.fn();
const mockAdminListAllDocuments = vi.fn();
const mockAdminRunQueryAt = vi.fn();

vi.mock("@/lib/family-friends/repository", () => ({
  listFamilyFriends: mockListFamilyFriends,
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminListAllDocuments: mockAdminListAllDocuments,
  adminRunQueryAt: mockAdminRunQueryAt,
}));

vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: mockRunWithRefreshedFirebaseToken,
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));

vi.mock("@/lib/auth/session-cookie", () => ({
  setSessionUserCookie: mockSetSessionUserCookie,
}));

vi.mock("@/lib/firestore/rest", () => ({
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  getDocument: mockGetDocument,
  listDocuments: mockListDocuments,
  runQuery: mockRunQuery,
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) => Boolean(fields?.[key]),
  readInteger: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "number" ? value : 0;
  },
  readString: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "string" ? value : "";
  },
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  },
  readTimestamp: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "string" ? value : "";
  },
}));

function memberDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/members/${id}`, fields: { deleted: false, ...fields } };
}

function notificationDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/notifications/${id}`, fields };
}

const MEMBERS = [
  memberDoc("parent-uid", {
    uid: "parent-uid",
    email: "parent@example.com",
    name: "Parent",
    role: "admin",
    avatarId: "avatar-02",
  }),
  memberDoc("child-uid", {
    uid: "child-uid",
    email: "child@example.com",
    name: "Child",
    role: "player",
    avatarId: "avatar-05",
    dashboardPrimaryColor: "#123456",
  }),
];

// n3 (chore_edited) is intentionally a non-feed kind and must never appear.
const NOTIFICATIONS = [
  notificationDoc("n1", {
    kind: "chore_completed",
    actorUid: "child-uid",
    actorEmail: "child@example.com",
    actorName: "Child",
    relatedIds: ["child-uid"],
    title: "Chore completed",
    message: "Child completed Dishes",
    choreId: "c1",
    createdAt: "2026-06-01T10:00:00.000Z",
  }),
  notificationDoc("n2", {
    kind: "chore_approved",
    actorUid: "parent-uid",
    actorEmail: "parent@example.com",
    actorName: "Parent",
    relatedIds: ["parent-uid", "child-uid"],
    title: "Chore approved",
    message: "Parent approved Dishes",
    choreId: "c1",
    createdAt: "2026-06-02T10:00:00.000Z",
  }),
  notificationDoc("n3", {
    kind: "chore_edited",
    actorUid: "parent-uid",
    relatedIds: ["parent-uid", "child-uid"],
    title: "Chore edited",
    message: "Parent edited Dishes",
    createdAt: "2026-06-02T12:00:00.000Z",
  }),
  notificationDoc("n4", {
    kind: "reward_claimed",
    actorUid: "sibling-uid",
    actorEmail: "sibling@example.com",
    actorName: "Sibling",
    relatedIds: ["sibling-uid"],
    title: "Reward redeemed",
    message: "Sibling redeemed Ice cream",
    createdAt: "2026-06-03T10:00:00.000Z",
  }),
  notificationDoc("n5", {
    kind: "chore_created",
    actorUid: "parent-uid",
    actorEmail: "parent@example.com",
    actorName: "Parent",
    relatedIds: ["parent-uid"],
    title: "New chore added",
    message: "Parent added Vacuum",
    createdAt: "2026-05-30T10:00:00.000Z",
  }),
];

function setSession(role: "admin" | "player") {
  const isAdmin = role === "admin";
  mockGetSessionFromRequest.mockReturnValue({
    uid: isAdmin ? "parent-uid" : "child-uid",
    email: isAdmin ? "parent@example.com" : "child@example.com",
    firebaseIdToken: "id-token",
    firebaseRefreshToken: "refresh-token",
  });
}

function feedRequest(query = "") {
  return new Request(`http://localhost/api/feed${query}`) as never;
}

describe("GET /api/feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });
    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/parent-uid" || path === "users/child-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });
    mockListFamilyFriends.mockResolvedValue([]);
    mockAdminListAllDocuments.mockResolvedValue([]);
    mockAdminRunQueryAt.mockResolvedValue([]);
    mockListDocuments.mockImplementation(async (path: string) => {
      if (path.endsWith("/members")) {
        return MEMBERS;
      }
      return [];
    });
    // Notifications are now read via an ordered runQuery (newest-first window).
    mockRunQuery.mockImplementation(
      async (structuredQuery: { from?: Array<{ collectionId?: string }> }) => {
        if (structuredQuery.from?.[0]?.collectionId === "notifications") {
          return [...NOTIFICATIONS].sort(
            (a, b) =>
              Date.parse(String(b.fields.createdAt)) - Date.parse(String(a.fields.createdAt)),
          );
        }
        return [];
      },
    );
  });

  it("rejects unauthenticated requests", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const { GET } = await import("./route");
    const response = await GET(feedRequest());
    expect(response.status).toBe(401);
  });

  it("returns an empty feed when the signed-in user has no active family", async () => {
    setSession("player");
    mockGetDocument.mockImplementation(async () => ({ fields: { familyIds: [] } }));
    const { GET } = await import("./route");
    const response = await GET(feedRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("returns only viewer-visible events for a player, newest first, excluding non-feed kinds", async () => {
    setSession("player");
    const { GET } = await import("./route");
    const response = await GET(feedRequest());
    const body = await response.json();
    // Player sees n2 (relatedIds include child) and n1 (own action), newest first.
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["n2", "n1"]);
    expect(body.items.map((item: { type: string }) => item.type)).toEqual([
      "chore_approved",
      "chore_completed",
    ]);
    // Sibling reward (n4), parent-only created (n5), and edited (n3) are not visible.
  });

  it("returns all family feed events for an admin, newest first", async () => {
    setSession("admin");
    const { GET } = await import("./route");
    const response = await GET(feedRequest());
    const body = await response.json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["n4", "n2", "n1", "n5"]);
    // Actor avatar/profile data is included where available.
    const completed = body.items.find((item: { id: string }) => item.id === "n1");
    expect(completed.actor).toMatchObject({ name: "Child", avatarId: "avatar-05" });
    expect(completed.metadata).toMatchObject({ choreId: "c1" });
  });

  it("condenses a finished routine into one card and hides its per-step events", async () => {
    setSession("admin");
    mockRunQuery.mockResolvedValue([
      notificationDoc("routine-done", {
        kind: "routine_completed",
        actorUid: "child-uid",
        actorEmail: "child@example.com",
        actorName: "Child",
        relatedIds: ["child-uid"],
        title: "Routine completed",
        message: '🎉 Child finished the "Water plants" routine and earned 5 bonus coins!',
        routineId: "routine-1",
        routineName: "Water plants",
        routineStepsJson: JSON.stringify([
          { choreId: "step-1", title: "Fill dog water bowl", coinValue: 5, skipped: false },
          { choreId: "step-2", title: "Water the grass", coinValue: 5, skipped: true },
        ]),
        createdAt: "2026-06-05T10:00:05.000Z",
      }),
      notificationDoc("step-1-done", {
        kind: "chore_completed",
        actorUid: "child-uid",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message: 'Child completed "Fill dog water bowl" (step 1 of 2...) and earned 5 coins.',
        choreId: "step-1",
        createdAt: "2026-06-05T10:00:00.000Z",
      }),
      notificationDoc("step-2-approved", {
        kind: "chore_approved",
        actorUid: "parent-uid",
        relatedIds: ["child-uid"],
        title: "Chore approved",
        message: 'Parent approved "Water the grass".',
        choreId: "step-2",
        createdAt: "2026-06-05T10:00:04.000Z",
      }),
      notificationDoc("unrelated-chore", {
        kind: "chore_completed",
        actorUid: "child-uid",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message: 'Child completed "Clean main floor".',
        choreId: "loose-chore",
        createdAt: "2026-06-05T09:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest())).json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      "routine-done",
      "unrelated-chore",
    ]);
    expect(body.items[0].metadata.routineSteps).toEqual([
      { choreId: "step-1", title: "Fill dog water bowl", coinValue: 5, skipped: false },
      { choreId: "step-2", title: "Water the grass", coinValue: 5, skipped: true },
    ]);
  });

  it("rolls a busy day up into one card per person, in the viewer's timezone", async () => {
    setSession("admin");
    const completion = (id: string, choreId: string, createdAt: string) =>
      notificationDoc(id, {
        kind: "chore_completed",
        actorUid: "child-uid",
        actorEmail: "child@example.com",
        actorName: "Child",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message: `Child completed "${choreId}" and earned 5 coins.`,
        choreId,
        choreTitle: choreId,
        createdAt,
      });
    mockRunQuery.mockResolvedValue([
      // 01:00 UTC is still the previous evening at UTC-6, so all four land on
      // the same local day and roll up together.
      completion("d4", "Wipe counters", "2026-06-06T01:00:00.000Z"),
      completion("d3", "Take out trash", "2026-06-05T23:00:00.000Z"),
      completion("d2", "Dishes", "2026-06-05T18:00:00.000Z"),
      completion("d1", "Make bed", "2026-06-05T15:00:00.000Z"),
      completion("older", "Sweep", "2026-06-01T15:00:00.000Z"),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?tzOffsetMinutes=360"))).json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].metadata).toMatchObject({
      day: "2026-06-05",
      dayChoreCount: 4,
      dayCoinsEarned: 20,
    });
    expect(body.items[0].message).toBe(
      "✨ Child is on a roll with 4 chores completed on Jun 5!",
    );
    expect(body.items[0].metadata.dayChores.map((chore: { title: string }) => chore.title)).toEqual([
      "Make bed",
      "Dishes",
      "Take out trash",
      "Wipe counters",
    ]);
    // A single completion on its own day is left as a normal card.
    expect(body.items[1].id).toBe("older");
  });

  it("rolls up the chores a parent added on the same day", async () => {
    setSession("admin");
    const added = (id: string, title: string, createdAt: string) =>
      notificationDoc(id, {
        kind: "chore_created",
        actorUid: "parent-uid",
        actorEmail: "parent@example.com",
        actorName: "Parent",
        relatedIds: ["parent-uid"],
        title: "New chore added",
        message: `Parent added "${title}" (5 coins).`,
        choreId: id,
        createdAt,
      });
    mockRunQuery.mockResolvedValue([
      added("a3", "Sweep the porch", "2026-06-05T12:00:00.000Z"),
      added("a2", "Go through kid's clothes", "2026-06-05T11:00:00.000Z"),
      added("a1", "Wash the car", "2026-06-05T10:00:00.000Z"),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?tzOffsetMinutes=0"))).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      type: "chore_created",
      message: "📝 Parent added 3 chores on Jun 5.",
      metadata: { dayKind: "created", dayChoreCount: 3 },
    });
    expect(body.items[0].metadata.dayChores.map((chore: { title: string }) => chore.title)).toEqual([
      "Wash the car",
      "Go through kid's clothes",
      "Sweep the porch",
    ]);
  });

  it("rebuilds the chore list for routines completed before step snapshots existed", async () => {
    setSession("admin");
    mockRunQuery.mockResolvedValue([
      notificationDoc("legacy-step-2", {
        kind: "chore_completed",
        actorUid: "child-uid",
        actorName: "Child",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message:
          'Child completed "Water vegetables" (step 2 of 2 in the "Water plants" routine) and earned 5 coins.',
        choreId: "step-2",
        choreTitle: "Water vegetables",
        createdAt: "2026-06-05T10:00:06.000Z",
      }),
      notificationDoc("legacy-routine", {
        kind: "routine_completed",
        actorUid: "child-uid",
        actorName: "Child",
        relatedIds: ["child-uid"],
        title: "Routine completed",
        message: '🎉 Child finished the "Water plants" routine and earned 5 bonus coins!',
        createdAt: "2026-06-05T10:00:05.000Z",
      }),
      notificationDoc("legacy-step-1", {
        kind: "chore_completed",
        actorUid: "child-uid",
        actorName: "Child",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message:
          'Child completed "Fill dog water bowl" (step 1 of 2 in the "Water plants" routine) and earned 5 coins.',
        choreId: "step-1",
        choreTitle: "Fill dog water bowl",
        createdAt: "2026-06-05T09:30:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest())).json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["legacy-routine"]);
    expect(body.items[0].metadata.routineSteps).toEqual([
      { choreId: "step-1", title: "Fill dog water bowl", coinValue: 5, skipped: false },
      { choreId: "step-2", title: "Water vegetables", coinValue: 5, skipped: false },
    ]);
  });

  it("normalizes legacy admin-on-behalf completions to the assigned child", async () => {
    setSession("admin");
    mockRunQuery.mockResolvedValue([
      notificationDoc("admin-completed-for-child", {
        kind: "chore_completed",
        actorUid: "parent-uid",
        actorEmail: "parent@example.com",
        actorName: "Parent",
        relatedIds: ["child-uid"],
        title: "Chore completed",
        message:
          'Parent marked "Tell everyone three things you are grateful for" (step 4 of 4 in the "Daily Gratitude" routine) complete and earned 3 coins.',
        choreId: "c-routine-step",
        createdAt: "2026-06-04T10:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest())).json();

    expect(body.items[0]).toMatchObject({
      actor: { uid: "child-uid", name: "Child", avatarId: "avatar-05" },
      message:
        'Child completed "Tell everyone three things you are grateful for" (step 4 of 4 in the "Daily Gratitude" routine) and earned 3 coins.',
    });
  });

  it("uses the child's avatar for a legacy routine completed by an admin", async () => {
    setSession("admin");
    mockRunQuery.mockResolvedValue([
      notificationDoc("admin-completed-routine-for-child", {
        kind: "routine_completed",
        actorUid: "parent-uid",
        actorEmail: "parent@example.com",
        actorName: "Parent",
        relatedIds: ["child-uid"],
        title: "Routine completed",
        message: '🎉 Child finished the "Daily Gratitude" routine and earned 3 bonus coins!',
        createdAt: "2026-06-04T10:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest())).json();

    expect(body.items[0]).toMatchObject({
      type: "routine_completed",
      actor: { uid: "child-uid", name: "Child", avatarId: "avatar-05" },
      message: '🎉 Child finished the "Daily Gratitude" routine and earned 3 bonus coins!',
    });
  });

  it("shares only positive friend activity, redacts surnames, and hides friend awards from players", async () => {
    setSession("player");
    mockListFamilyFriends.mockResolvedValue([
      { familyId: "family-2", familyName: "Cousins", connectedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    mockAdminListAllDocuments.mockResolvedValue([
      memberDoc("aaron-uid", {
        uid: "aaron-uid",
        email: "aaron@example.com",
        name: "Aaron Cousin",
        role: "player",
        avatarId: "avatar-09",
      }),
    ]);
    mockAdminRunQueryAt.mockResolvedValue([
      notificationDoc("friend-win", {
        kind: "chore_completed",
        actorUid: "aaron-uid",
        actorEmail: "aaron@example.com",
        actorName: "Aaron Cousin",
        title: "Chore completed",
        message: "Aaron Cousin completed Make the bed",
        createdAt: "2026-06-04T10:00:00.000Z",
      }),
      notificationDoc("friend-edit", {
        kind: "chore_edited",
        actorUid: "aaron-uid",
        actorName: "Aaron Cousin",
        title: "Chore edited",
        message: "Aaron Cousin edited a chore",
        createdAt: "2026-06-04T11:00:00.000Z",
      }),
      notificationDoc("friend-award", {
        kind: "family_reward_created",
        actorUid: "aaron-uid",
        actorName: "Aaron Cousin",
        title: "New Family Award",
        message: "Aaron Cousin created Movie night",
        rewardId: "reward-1",
        createdAt: "2026-06-04T12:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?scope=friends"))).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "family-2:friend-win",
      message: "Aaron completed Make the bed",
      actor: { name: "Aaron", avatarId: "avatar-09" },
      sourceFamily: { id: "family-2", name: "Cousins", isFriend: true },
    });
  });

  it("shows friend-created Family Awards with a copy action only to admins", async () => {
    setSession("admin");
    mockListFamilyFriends.mockResolvedValue([
      { familyId: "family-2", familyName: "Cousins", connectedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    mockAdminListAllDocuments.mockResolvedValue([]);
    mockAdminRunQueryAt.mockResolvedValue([
      notificationDoc("friend-award", {
        kind: "family_reward_created",
        actorName: "Aunt Amy",
        title: "New Family Award",
        message: "Aunt Amy created Movie night",
        rewardId: "reward-1",
        rewardDescription: "Movie night",
        rewardCoinCost: 20,
        createdAt: "2026-06-04T12:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?scope=friends"))).json();
    expect(body.items[0]).toMatchObject({
      type: "family_award_created",
      action: "copy_friend_award",
      metadata: { rewardId: "reward-1", rewardDescription: "Movie night", rewardCoinCost: 20 },
    });
  });

  it("offers parents a routine copy action for friend-created and completed routines", async () => {
    setSession("admin");
    mockListFamilyFriends.mockResolvedValue([
      { familyId: "family-2", familyName: "Cousins", connectedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    mockAdminListAllDocuments.mockResolvedValue([]);
    mockAdminRunQueryAt.mockResolvedValue([
      notificationDoc("friend-routine-created", {
        kind: "routine_created",
        actorName: "Aunt Amy",
        title: "Routine added",
        message: "Aunt Amy added the Morning routine.",
        routineId: "routine-1",
        routineName: "Morning",
        createdAt: "2026-06-04T12:00:00.000Z",
      }),
      notificationDoc("friend-routine-completed", {
        kind: "routine_completed",
        actorName: "Alex Cousin",
        title: "Routine completed",
        message: 'Alex Cousin finished the "Bedtime" routine.',
        createdAt: "2026-06-04T13:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?scope=friends"))).json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      type: "routine_completed",
      action: "copy_friend_routine",
      metadata: { routineName: "Bedtime" },
    });
    expect(body.items[1]).toMatchObject({
      type: "routine_created",
      action: "copy_friend_routine",
      metadata: { routineId: "routine-1", routineName: "Morning" },
    });
  });

  it("keeps friend routine completions visible to players without exposing the parent copy action", async () => {
    setSession("player");
    mockListFamilyFriends.mockResolvedValue([
      { familyId: "family-2", familyName: "Cousins", connectedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    mockAdminListAllDocuments.mockResolvedValue([]);
    mockAdminRunQueryAt.mockResolvedValue([
      notificationDoc("friend-routine-completed", {
        kind: "routine_completed",
        actorName: "Alex Cousin",
        title: "Routine completed",
        message: "Alex Cousin finished the Bedtime routine.",
        routineId: "routine-2",
        routineName: "Bedtime",
        createdAt: "2026-06-04T13:00:00.000Z",
      }),
    ]);

    const { GET } = await import("./route");
    const body = await (await GET(feedRequest("?scope=friends"))).json();
    expect(body.items[0]).toMatchObject({
      type: "routine_completed",
      action: null,
      metadata: { routineName: "Bedtime" },
    });
    expect(body.items[0].metadata).not.toHaveProperty("routineId");
  });

  it("caps the page size at the maximum and paginates", async () => {
    setSession("admin");
    const { GET } = await import("./route");
    const capped = await (await GET(feedRequest("?limit=999"))).json();
    expect(capped.pagination.pageSize).toBe(50);

    const pageOne = await (await GET(feedRequest("?limit=1&page=1"))).json();
    const pageTwo = await (await GET(feedRequest("?limit=1&page=2"))).json();
    expect(pageOne.items.map((item: { id: string }) => item.id)).toEqual(["n4"]);
    expect(pageTwo.items.map((item: { id: string }) => item.id)).toEqual(["n2"]);
    expect(pageOne.pagination.hasMore).toBe(true);
  });
});
