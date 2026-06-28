import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunWithRefreshedFirebaseToken = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockSetSessionUserCookie = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockListAllDocuments = vi.fn();
const mockRunQuery = vi.fn();
const mockListFamilyCategories = vi.fn();
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
  boolField: (value: boolean) => value,
  createOrReplaceDocument: vi.fn(),
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  getDocument: mockGetDocument,
  integerField: (value: number) => value,
  listDocuments: mockListDocuments,
  listAllDocuments: mockListAllDocuments,
  runQuery: mockRunQuery,
  patchDocument: vi.fn(),
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
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
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
  emitFamilyActivity: vi.fn(),
}));

vi.mock("@/lib/preferences/completion-window", () => ({
  parseCompletionWindow: () => null,
}));

vi.mock("@/lib/ws/publish-family-activity", () => ({
  publishFamilyActivity: vi.fn(),
}));

vi.mock("@/lib/ws/family-auth-token", () => ({
  createFamilySocketAuthToken: () => "ws-auth-token",
}));

vi.mock("@/lib/google/tasks-sync", () => ({
  GOOGLE_TASKS_CHORE_SOURCE: "google_tasks",
  syncGoogleTasksForUser: mockSyncGoogleTasksForUser,
}));

vi.mock("@/lib/theme/member-primary-color", () => ({
  resolveMemberPrimaryColor: (value: string | undefined) => value,
}));

vi.mock("@/lib/chores/recurrence", () => ({
  normalizeCoinValue: (value: number) => (typeof value === "number" ? value : 0),
  normalizeRecurrenceConfig: (input: {
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceUnit?: string;
  }) => ({
    recurrenceType: input.recurrenceType || "none",
    recurrenceInterval: input.recurrenceInterval || 0,
    recurrenceUnit: input.recurrenceUnit || "",
  }),
  parseCoinValue: () => null,
  parseRequireApproval: () => false,
  recurrenceLabel: () => "Repeats",
}));

vi.mock("@/lib/chores/types", () => ({
  normalizeChoreType: (value: string | undefined, fallback: string) => value || fallback,
}));

vi.mock("@/lib/family/categories", () => ({
  buildCategoryMap: () => new Map(),
  hasAllCategoryIds: () => true,
  listFamilyCategories: mockListFamilyCategories,
  normalizeCategoryIds: () => [],
  readChoreCategoryIds: () => [],
  resolveChoreCategories: () => [],
}));

vi.mock("@/lib/achievements/service", () => ({
  trackAchievementEvent: vi.fn(),
}));

describe("GET /api/chores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));

    mockGetSessionFromRequest.mockReturnValue({
      uid: "admin-uid",
      memberId: "admin-uid",
      email: "admin@example.com",
      firebaseIdToken: "id-token",
      firebaseRefreshToken: "refresh-token",
    });

    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });

    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/admin-uid") {
        return {
          fields: {
            familyIds: ["family-1"],
            googleTasksLinked: false,
          },
        };
      }
      if (path === "families/family-1/members/admin-uid") {
        return {
          fields: {
            role: "admin",
            deleted: false,
          },
        };
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    mockListDocuments.mockImplementation(async (path: string) => {
      if (path === "families/family-1/members") {
        return [
          {
            name: "projects/test/databases/(default)/documents/families/family-1/members/admin-uid",
            fields: {
              uid: "admin-uid",
              name: "Admin",
              email: "admin@example.com",
              deleted: false,
            },
          },
        ];
      }
      throw new Error(`Unexpected listDocuments path: ${path}`);
    });

    mockListAllDocuments.mockResolvedValue([]);
    mockRunQuery.mockImplementation(
      async (
        structuredQuery: { from?: Array<{ collectionId?: string }> },
        _idToken: string,
        parentPath?: string,
      ) => {
        const collectionId = structuredQuery.from?.[0]?.collectionId;
        if (collectionId === "chores" && parentPath === "families/family-1") {
          return [
          {
            name: "projects/test/databases/(default)/documents/families/family-1/chores/tomorrow-open",
            fields: {
              title: "Pack school bag",
              status: "Open",
              deleted: false,
              assigneeId: "admin-uid",
              assigneeIds: ["admin-uid"],
              assigneeScope: "single",
              assigneeName: "Admin",
              dueDate: "2026-06-01",
              coinValue: 5,
              requireApproval: false,
              recurrenceType: "none",
              recurrenceInterval: 0,
              recurrenceUnit: "",
              createdAt: "2026-05-30T12:00:00.000Z",
              sortOrder: { integerValue: "0" },
              source: "manual",
            },
          },
          {
            name: "projects/test/databases/(default)/documents/families/family-1/chores/far-future-open",
            fields: {
              title: "Next year task",
              status: "Open",
              deleted: false,
              assigneeId: "admin-uid",
              assigneeIds: ["admin-uid"],
              assigneeScope: "single",
              assigneeName: "Admin",
              dueDate: "2027-06-01",
              coinValue: 5,
              requireApproval: false,
              recurrenceType: "none",
              recurrenceInterval: 0,
              recurrenceUnit: "",
              createdAt: "2026-05-30T12:00:00.000Z",
              sortOrder: { integerValue: "1" },
              source: "google_tasks",
            },
          },
          ];
        }
        throw new Error(
          `Unexpected runQuery: ${collectionId ?? "?"} @ ${parentPath ?? "?"}`,
        );
      },
    );

    mockListFamilyCategories.mockResolvedValue([]);
    mockSyncGoogleTasksForUser.mockResolvedValue({
      kind: "skipped",
      reason: "not_linked",
      importedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      pushedCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the full chore archive including far-future chores", async () => {
    const { GET } = await import("./route");
    const request = {
      nextUrl: new URL(
        "http://localhost/api/chores?page=1&limit=50&sortBy=sortOrder&sortDir=asc",
      ),
    } as Request & { nextUrl: URL };

    const response = await GET(request as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chores).toHaveLength(2);
    expect(payload.chores.map((chore: { id: string }) => chore.id)).toEqual([
      "tomorrow-open",
      "far-future-open",
    ]);
    expect(payload.totalUnfiltered).toBe(2);
    expect(payload.pagination.total).toBe(2);
    expect(Array.isArray(payload.familyCategories)).toBe(true);
  });

  it("applies the coin range filter", async () => {
    const { GET } = await import("./route");
    const request = {
      nextUrl: new URL(
        "http://localhost/api/chores?page=1&limit=50&sortBy=sortOrder&sortDir=asc&coinMin=6",
      ),
    } as Request & { nextUrl: URL };

    const response = await GET(request as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.chores).toHaveLength(0);
    expect(payload.totalUnfiltered).toBe(2);
  });

  it("filters to recurring chores only", async () => {
    const { GET } = await import("./route");
    const request = {
      nextUrl: new URL(
        "http://localhost/api/chores?page=1&limit=50&sortBy=sortOrder&sortDir=asc&status=recurring",
      ),
    } as Request & { nextUrl: URL };

    const response = await GET(request as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    // Both fixtures use recurrenceType "none", so none match.
    expect(payload.chores).toHaveLength(0);
  });
});
