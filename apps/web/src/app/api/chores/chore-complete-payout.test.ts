import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockPatchDocument = vi.fn();
const mockCommitWrites = vi.fn();
const mockApplyWalletDelta = vi.fn();
const mockEmitFamilyActivity = vi.fn();
const mockPublishFamilyActivity = vi.fn();
const mockSyncGoogleTasksForUser = vi.fn();

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
  boolField: (value: boolean) => value,
  createOrReplaceDocument: vi.fn(),
  getDocument: mockGetDocument,
  integerField: (value: number) => value,
  listDocuments: mockListDocuments,
  commitWrites: mockCommitWrites,
  patchDocument: mockPatchDocument,
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) =>
    Boolean(fields?.[key]),
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
  stringArrayField: (value: string[]) => value,
  stringField: (value: string) => value,
  timestampField: (value: string) => value,
}));

vi.mock("@/lib/notifications/events", () => ({
  emitFamilyActivity: mockEmitFamilyActivity,
}));

vi.mock("@/lib/economy/wallet", () => ({
  applyWalletDelta: mockApplyWalletDelta,
}));

vi.mock("@/lib/ws/publish-family-activity", () => ({
  publishFamilyActivity: mockPublishFamilyActivity,
}));

vi.mock("@/lib/theme/member-primary-color", () => ({
  resolveMemberPrimaryColor: (value: string | undefined) => value,
}));

vi.mock("@/lib/google/tasks-sync", () => ({
  GOOGLE_TASKS_CHORE_SOURCE: "google_tasks",
  syncGoogleTasksForUser: mockSyncGoogleTasksForUser,
}));

vi.mock("@/lib/chores/recurrence", () => ({
  DEFAULT_CHORE_COIN_VALUE: 5,
  nextRecurringDueDate: () => "2026-04-27",
  normalizeCoinValue: (value: number) => (typeof value === "number" ? value : 0),
  normalizeRecurrenceConfig: () => ({
    recurrenceType: "none",
    recurrenceInterval: 0,
    recurrenceUnit: "",
  }),
  parseCoinValue: () => null,
  parseRequireApproval: () => false,
  recurrenceLabel: () => "Repeats",
}));

vi.mock("@/lib/family/categories", () => ({
  buildCategoryMap: () => new Map<string, { id: string; name: string }>(),
  hasAllCategoryIds: () => true,
  listFamilyCategories: vi.fn().mockResolvedValue([]),
  normalizeCategoryIds: () => [],
  readChoreCategoryIds: () => [],
  resolveChoreCategories: () => [],
}));

describe("PATCH /api/chores/[choreId] complete payout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSessionFromRequest.mockReturnValue({
      uid: "admin-uid",
      memberId: "admin-uid",
      email: "admin@example.com",
      name: "Admin",
      firebaseIdToken: "id-token",
      firebaseRefreshToken: "refresh-token",
    });

    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });

    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/admin-uid" || path === "users/player-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/chores/chore-1") {
        return {
          fields: {
            title: "Take out trash",
            assigneeId: "legacy-player@example.com",
            source: "manual",
            googleTaskOwnerUid: "",
            coinValue: 5,
            details: "",
            requireApproval: false,
            recurrenceType: "none",
            recurrenceInterval: 0,
            recurrenceUnit: "",
            status: "Open",
          },
        };
      }
      if (path === "families/family-1/members/admin-uid") {
        return {
          fields: {
            uid: "admin-uid",
            email: "admin@example.com",
            role: "admin",
            deleted: false,
          },
        };
      }
      if (
        path === "families/family-1/members/admin@example.com" ||
        path === "families/family-1/members/legacy-player@example.com"
      ) {
        throw new Error("FIRESTORE_HTTP_404");
      }
      if (path === "users/player-uid/achievementState/state") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    mockListDocuments.mockImplementation(async (path: string) => {
      if (path === "families/family-1/members") {
        return [
          {
            name: "projects/test/databases/(default)/documents/families/family-1/members/player-uid",
            fields: {
              uid: "player-uid",
              email: "legacy-player@example.com",
              name: "Ross Bryson",
              role: "player",
              deleted: false,
            },
          },
        ];
      }
      if (path === "families/family-1/chores") {
        return [
          {
            name: "projects/test/databases/(default)/documents/families/family-1/chores/chore-1",
            fields: {
              assigneeId: "legacy-player@example.com",
              status: "Approved",
              deleted: false,
              submittedAt: "2026-04-27T10:00:00.000Z",
            },
          },
        ];
      }
      if (path === "users/player-uid/achievements") {
        return [];
      }
      throw new Error(`Unexpected listDocuments path: ${path}`);
    });

    mockPatchDocument.mockResolvedValue(undefined);
    // These tests cover coin payout, not the New Skill Bonus (that has its own
    // suite). The bonus claim is an `exists: false` commit against
    // families/*/skillBonuses/*, so rejecting that specific write simulates an
    // already-claimed bonus and keeps the payout assertions isolated. Every other
    // batched write — notably the chore status change — succeeds.
    mockCommitWrites.mockImplementation(async (writes: Array<{ update?: { path?: string } }>) => {
      if (writes.some((write) => write.update?.path?.includes("/skillBonuses/"))) {
        throw new Error("FIRESTORE_HTTP_409_already_exists");
      }
      return undefined;
    });
    mockApplyWalletDelta.mockResolvedValue(5);
    mockEmitFamilyActivity.mockResolvedValue(undefined);
    mockPublishFamilyActivity.mockResolvedValue(undefined);
    mockSyncGoogleTasksForUser.mockResolvedValue(undefined);
  });

  it("credits coins to resolved uid when assignee id is a legacy alias and approval is not required", async () => {
    const { PATCH } = await import("./[choreId]/route");

    const response = await PATCH(
      new Request("http://localhost/api/chores/chore-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "complete" }),
      }) as never,
      { params: Promise.resolve({ choreId: "chore-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockApplyWalletDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "player-uid",
        delta: 5,
        reason: "chore_complete",
        choreId: "chore-1",
      }),
    );
  });

  it("does not fail the chore update when follow-up Google Tasks sync fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSyncGoogleTasksForUser.mockRejectedValueOnce(new Error("fetch failed"));
    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/admin-uid" || path === "users/player-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/chores/chore-1") {
        return {
          fields: {
            title: "Take out trash",
            assigneeId: "legacy-player@example.com",
            source: "google_tasks",
            googleTaskOwnerUid: "player-uid",
            coinValue: 5,
            details: "",
            requireApproval: false,
            recurrenceType: "none",
            recurrenceInterval: 0,
            recurrenceUnit: "",
            status: "Open",
          },
        };
      }
      if (path === "families/family-1/members/admin-uid") {
        return {
          fields: {
            uid: "admin-uid",
            email: "admin@example.com",
            role: "admin",
            deleted: false,
          },
        };
      }
      if (
        path === "families/family-1/members/admin@example.com" ||
        path === "families/family-1/members/legacy-player@example.com"
      ) {
        throw new Error("FIRESTORE_HTTP_404");
      }
      if (path === "users/player-uid/achievementState/state") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    const { PATCH } = await import("./[choreId]/route");

    const response = await PATCH(
      new Request("http://localhost/api/chores/chore-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "complete" }),
      }) as never,
      { params: Promise.resolve({ choreId: "chore-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockSyncGoogleTasksForUser).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "player-uid", force: true }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[GOOGLE_TASKS_SYNC_AFTER_CHORE_ERROR]",
      "fetch failed",
    );
    consoleErrorSpy.mockRestore();
  });

  it("auto-approves and pays out when an admin completes an approval-required chore", async () => {
    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/admin-uid" || path === "users/player-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/chores/chore-1") {
        return {
          fields: {
            title: "Take out trash",
            assigneeId: "legacy-player@example.com",
            source: "manual",
            googleTaskOwnerUid: "",
            coinValue: 5,
            details: "",
            requireApproval: true,
            recurrenceType: "none",
            recurrenceInterval: 0,
            recurrenceUnit: "",
            status: "Open",
          },
        };
      }
      if (path === "families/family-1/members/admin-uid") {
        return {
          fields: {
            uid: "admin-uid",
            email: "admin@example.com",
            role: "admin",
            deleted: false,
          },
        };
      }
      if (
        path === "families/family-1/members/admin@example.com" ||
        path === "families/family-1/members/legacy-player@example.com"
      ) {
        throw new Error("FIRESTORE_HTTP_404");
      }
      if (path === "users/player-uid/achievementState/state") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    const { PATCH } = await import("./[choreId]/route");

    const response = await PATCH(
      new Request("http://localhost/api/chores/chore-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "complete" }),
      }) as never,
      { params: Promise.resolve({ choreId: "chore-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    // The status change is written via a batched commit (together with any
    // spawned recurring occurrence) rather than a standalone patch.
    expect(mockCommitWrites).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          update: expect.objectContaining({
            path: "families/family-1/chores/chore-1",
            fields: expect.objectContaining({ status: "Approved" }),
            updateMask: expect.arrayContaining(["status"]),
          }),
        }),
      ]),
      "id-token",
    );
    expect(mockApplyWalletDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "player-uid",
        delta: 5,
        reason: "chore_complete",
        choreId: "chore-1",
      }),
    );
    expect(mockEmitFamilyActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: "player-uid",
        actorEmail: "",
        actorName: "Ross Bryson",
        title: "Chore completed",
        message: 'Ross Bryson completed "Take out trash" and earned 5 coins.',
        pushType: "chore_completed",
      }),
    );
  });
});
