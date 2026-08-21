import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockCreateOrReplaceDocument = vi.fn();
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
  createOrReplaceDocument: mockCreateOrReplaceDocument,
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  getDocument: mockGetDocument,
  listDocuments: mockListDocuments,
  runQuery: mockRunQuery,
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) =>
    Boolean(fields?.[key]),
  readString: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "string" ? value : "";
  },
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  },
  readTimestamp: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    return typeof value === "string" ? value : "";
  },
  stringField: (value: string) => value,
  timestampField: (value: string) => value,
}));

describe("PATCH /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));

    mockGetSessionFromRequest.mockReturnValue({
      uid: "child-uid",
      memberId: "child-uid",
      role: "player",
      email: "child@example.com",
      firebaseIdToken: "id-token",
      firebaseRefreshToken: "refresh-token",
      authUid: "parent-uid",
      authMemberId: "parent-uid",
      authRole: "admin",
      authEmail: "parent@example.com",
    });

    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });

    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/child-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/members/child-uid") {
        return {
          fields: {
            uid: "child-uid",
            email: "child@example.com",
            role: "player",
            deleted: false,
          },
        };
      }
      if (path === "families/family-1/members/child@example.com") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      if (path === "families/family-1/notifications/visible-to-child") {
        return {
          fields: {
            actorUid: "parent-uid",
            relatedIds: ["child-uid"],
          },
        };
      }
      if (path === "families/family-1/notifications/triggered-by-child") {
        return {
          fields: {
            actorUid: "child-uid",
            relatedIds: ["child-uid"],
          },
        };
      }
      if (path === "families/family-1/notifications/hidden-from-child") {
        return {
          fields: {
            actorUid: "parent-uid",
            relatedIds: ["sibling-uid"],
          },
        };
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    mockCreateOrReplaceDocument.mockResolvedValue(undefined);
    mockListDocuments.mockResolvedValue([]);
  });

  it("marks only child-visible notifications as seen while switched from a parent account", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({
          ids: ["visible-to-child", "triggered-by-child", "hidden-from-child"],
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(1);
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledWith(
      "families/family-1/notificationSeen/child-uid_visible-to-child",
      expect.objectContaining({
        uid: "child-uid",
        viewerAuthUid: "parent-uid",
        notificationId: "visible-to-child",
        seenAt: "2026-05-31T12:00:00.000Z",
        updatedAt: "2026-05-31T12:00:00.000Z",
      }),
      "id-token",
    );
  });
});

function notificationDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/notifications/${id}`, fields };
}

function seenMarkerDoc(uid: string, notificationId: string) {
  return {
    name: `families/family-1/notificationSeen/${uid}_${notificationId}`,
    fields: { uid, notificationId },
  };
}

// n1: triggered by the child (own action), n2: visible only to a sibling,
// n3: addressed to the child by a parent. Provided oldest-first so the route's
// newest-first ordering is actually exercised.
const GET_NOTIFICATIONS = [
  notificationDoc("n1", {
    kind: "chore_completed",
    actorUid: "child-uid",
    actorEmail: "child@example.com",
    relatedIds: ["child-uid"],
    title: "Chore completed",
    message: "Child completed Dishes",
    createdAt: "2026-06-01T10:00:00.000Z",
  }),
  notificationDoc("n2", {
    kind: "reward_claimed",
    actorUid: "sibling-uid",
    actorEmail: "sibling@example.com",
    relatedIds: ["sibling-uid"],
    title: "Reward redeemed",
    message: "Sibling redeemed Ice cream",
    createdAt: "2026-06-02T10:00:00.000Z",
  }),
  notificationDoc("n3", {
    kind: "chore_approved",
    actorUid: "parent-uid",
    actorEmail: "parent@example.com",
    relatedIds: ["parent-uid", "child-uid"],
    title: "Chore approved",
    message: "Parent approved Dishes",
    createdAt: "2026-06-03T10:00:00.000Z",
  }),
];

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });

    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/parent-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "users/child-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/members/parent-uid") {
        return { fields: { uid: "parent-uid", email: "parent@example.com", role: "admin" } };
      }
      if (path === "families/family-1/members/child-uid") {
        return { fields: { uid: "child-uid", email: "child@example.com", role: "player" } };
      }
      // Email-keyed member lookups are expected to miss for accepted members.
      throw new Error("FIRESTORE_HTTP_404");
    });

    mockListDocuments.mockResolvedValue([]);
  });

  function setSession(role: "admin" | "player") {
    const isAdmin = role === "admin";
    mockGetSessionFromRequest.mockReturnValue({
      uid: isAdmin ? "parent-uid" : "child-uid",
      email: isAdmin ? "parent@example.com" : "child@example.com",
      firebaseIdToken: "id-token",
      firebaseRefreshToken: "refresh-token",
    });
  }

  // Returns the most-recent-first notifications and the viewer's seen markers,
  // dispatching on the queried collection like the real ordered runQuery.
  function mockQueries(seenMarkers: Array<ReturnType<typeof seenMarkerDoc>>) {
    mockRunQuery.mockImplementation(
      async (structuredQuery: { from?: Array<{ collectionId?: string }> }) => {
        const collectionId = structuredQuery.from?.[0]?.collectionId;
        if (collectionId === "notifications") {
          return [...GET_NOTIFICATIONS].sort(
            (a, b) =>
              Date.parse(String(b.fields.createdAt)) - Date.parse(String(a.fields.createdAt)),
          );
        }
        if (collectionId === "notificationSeen") {
          return seenMarkers;
        }
        return [];
      },
    );
  }

  function getRequest(query = "") {
    // The route reads request.nextUrl.searchParams, so provide a NextRequest-like
    // shape rather than a plain Request.
    return { nextUrl: new URL(`http://localhost/api/notifications${query}`) } as never;
  }

  it("rejects unauthenticated requests", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const { GET } = await import("./route");
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
  });

  it("returns all notifications newest-first for an admin, applying seen markers", async () => {
    setSession("admin");
    // The admin has only seen n1; the parent triggered n3 themselves (auto-seen).
    mockQueries([seenMarkerDoc("parent-uid", "n1")]);
    const { GET } = await import("./route");

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notifications.map((item: { id: string }) => item.id)).toEqual(["n3", "n2", "n1"]);
    const seenById = Object.fromEntries(
      body.notifications.map((item: { id: string; seen: boolean }) => [item.id, item.seen]),
    );
    expect(seenById).toEqual({ n1: true, n2: false, n3: true });
    // Only n2 is unseen (n1 has a marker, n3 was triggered by the viewer).
    expect(body.unseenCount).toBe(1);
  });

  it("hides notifications not addressed to a player and auto-sees their own actions", async () => {
    setSession("player");
    mockQueries([]);
    const { GET } = await import("./route");

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    // n2 (sibling-only) is hidden; n3 and n1 (own action) are visible, newest first.
    expect(body.notifications.map((item: { id: string }) => item.id)).toEqual(["n3", "n1"]);
    const seenById = Object.fromEntries(
      body.notifications.map((item: { id: string; seen: boolean }) => [item.id, item.seen]),
    );
    // n1 was triggered by the child, so it is auto-seen; n3 is unseen.
    expect(seenById).toEqual({ n1: true, n3: false });
    expect(body.unseenCount).toBe(1);
  });

  it("filters to unseen notifications when unseen=true is requested", async () => {
    setSession("player");
    mockQueries([]);
    const { GET } = await import("./route");

    const response = await GET(getRequest("?unseen=true"));
    const body = await response.json();

    expect(body.notifications.map((item: { id: string }) => item.id)).toEqual(["n3"]);
    // unseenCount still reflects the full visible window, not just the filtered page.
    expect(body.unseenCount).toBe(1);
  });

  it("scopes the seen-marker query to the requesting viewer", async () => {
    setSession("player");
    mockQueries([]);
    const { GET } = await import("./route");

    await GET(getRequest());

    const seenQueryCall = mockRunQuery.mock.calls.find(
      ([structuredQuery]) => structuredQuery?.from?.[0]?.collectionId === "notificationSeen",
    );
    expect(seenQueryCall).toBeDefined();
    expect(seenQueryCall?.[0].where.fieldFilter).toMatchObject({
      field: { fieldPath: "uid" },
      op: "EQUAL",
      value: { stringValue: "child-uid" },
    });
  });

  // summary=count powers the header badge. It used to build the entire list —
  // projecting, sorting, searching and paginating — then throw it away and return
  // only the number, which made it the slowest route in production. These lock in
  // that the fast path still answers with exactly the same count.
  describe("summary=count", () => {
    it("matches the list-mode unseenCount for an admin and returns no items", async () => {
      setSession("admin");
      mockQueries([seenMarkerDoc("parent-uid", "n1")]);
      const { GET } = await import("./route");

      const listBody = await (await GET(getRequest())).json();
      const countResponse = await GET(getRequest("?summary=count"));
      const countBody = await countResponse.json();

      expect(countResponse.status).toBe(200);
      expect(countBody.unseenCount).toBe(listBody.unseenCount);
      expect(countBody.unseenCount).toBe(1);
      expect(countBody.notifications).toEqual([]);
    });

    it("matches the list-mode unseenCount for a player, honouring visibility rules", async () => {
      setSession("player");
      mockQueries([]);
      const { GET } = await import("./route");

      const listBody = await (await GET(getRequest())).json();
      const countBody = await (await GET(getRequest("?summary=count"))).json();

      // n2 is addressed to a sibling and must not be counted; n1 was triggered by
      // this child so it is auto-seen. Only n3 remains unseen.
      expect(countBody.unseenCount).toBe(listBody.unseenCount);
      expect(countBody.unseenCount).toBe(1);
    });

    it("projects the notification query to only the fields the count needs", async () => {
      setSession("admin");
      mockQueries([]);
      const { GET } = await import("./route");

      await GET(getRequest("?summary=count"));

      const call = mockRunQuery.mock.calls.find(
        ([structuredQuery]) => structuredQuery?.from?.[0]?.collectionId === "notifications",
      );
      expect(call?.[0].select).toEqual({
        fields: [{ fieldPath: "kind" }, { fieldPath: "actorUid" }, { fieldPath: "relatedIds" }],
      });
    });

    it("does not project the query in list mode, which needs whole documents", async () => {
      setSession("admin");
      mockQueries([]);
      const { GET } = await import("./route");

      await GET(getRequest());

      const call = mockRunQuery.mock.calls.find(
        ([structuredQuery]) => structuredQuery?.from?.[0]?.collectionId === "notifications",
      );
      expect(call?.[0].select).toBeUndefined();
    });
  });
});
