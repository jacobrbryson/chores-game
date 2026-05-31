import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockCreateOrReplaceDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();

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
