import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockRunQuery = vi.fn();

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
