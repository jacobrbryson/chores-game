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
const mockClaimNewSkillBonus = vi.fn();

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
  listAllDocuments: vi.fn().mockResolvedValue([]),
  listDocuments: mockListDocuments,
  commitWrites: mockCommitWrites,
  patchDocument: mockPatchDocument,
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
  normalizeRecurrenceConfig: () => ({ recurrenceType: "none", recurrenceInterval: 0, recurrenceUnit: "" }),
  parseCoinValue: () => null,
  parseRequireApproval: () => false,
  recurrenceLabel: () => "Repeats",
}));
vi.mock("@/lib/chores/skill-bonus", () => ({
  NEW_SKILL_BONUS_AMOUNT: 5,
  canonicalRecurringChoreId: (
    fields: Record<string, unknown> | undefined,
    choreId: string,
  ) => (typeof fields?.recurrenceRootChoreId === "string" && fields.recurrenceRootChoreId
    ? (fields.recurrenceRootChoreId as string)
    : choreId),
  claimNewSkillBonus: mockClaimNewSkillBonus,
}));
vi.mock("@/lib/family/categories", () => ({
  buildCategoryMap: () => new Map(),
  hasAllCategoryIds: () => true,
  listFamilyCategories: vi.fn().mockResolvedValue([]),
  normalizeCategoryIds: () => [],
  readChoreCategoryIds: () => [],
  resolveChoreCategories: () => [],
}));

function buildPlayerSession() {
  // Kiosk Mode swaps the active identity to the selected player, so the player
  // uid is the session uid for kiosk completions.
  return {
    uid: "player-uid",
    memberId: "player-uid",
    email: "player@example.com",
    name: "Kid",
    firebaseIdToken: "id-token",
    firebaseRefreshToken: "refresh-token",
  };
}

function installPlayerCompleteMocks() {
  mockGetSessionFromRequest.mockReturnValue(buildPlayerSession());
  mockGetDocument.mockImplementation(async (path: string) => {
    if (path === "users/player-uid") {
      return { fields: { familyIds: ["family-1"] } };
    }
    if (path === "families/family-1/chores/chore-1") {
      return {
        fields: {
          title: "Make bed",
          assigneeId: "player-uid",
          source: "manual",
          googleTaskOwnerUid: "",
          coinValue: 10,
          details: "",
          requireApproval: false,
          recurrenceType: "none",
          recurrenceInterval: 0,
          recurrenceUnit: "",
          status: "Open",
        },
      };
    }
    if (path === "families/family-1/members/player-uid") {
      return { fields: { uid: "player-uid", email: "player@example.com", role: "player", deleted: false } };
    }
    if (path === "families/family-1/members/player@example.com") {
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
          fields: { uid: "player-uid", email: "player@example.com", role: "player", deleted: false },
        },
      ];
    }
    if (path === "users/player-uid/achievements") {
      return [];
    }
    throw new Error(`Unexpected listDocuments path: ${path}`);
  });
}

describe("PATCH /api/chores/[choreId] new skill bonus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });
    mockPatchDocument.mockResolvedValue(undefined);
    mockCommitWrites.mockResolvedValue(undefined);
    mockApplyWalletDelta.mockResolvedValue(15);
    mockEmitFamilyActivity.mockResolvedValue(undefined);
    mockPublishFamilyActivity.mockResolvedValue(undefined);
    mockSyncGoogleTasksForUser.mockResolvedValue(undefined);
    installPlayerCompleteMocks();
  });

  async function completeChore() {
    const { PATCH } = await import("./[choreId]/route");
    return PATCH(
      new Request("http://localhost/api/chores/chore-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "complete" }),
      }) as never,
      { params: Promise.resolve({ choreId: "chore-1" }) },
    );
  }

  it("awards +5 to the completing player the first time and reports it in the response", async () => {
    mockClaimNewSkillBonus.mockResolvedValue({ firstTime: true });

    const response = await completeChore();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      newSkillBonus: { awarded: true, amount: 5, totalCoins: 5, playerUids: ["player-uid"] },
    });
    // Kiosk attribution: the bonus is paid to the selected player, not an admin.
    expect(mockApplyWalletDelta).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "player-uid", delta: 5, reason: "new_skill_bonus" }),
    );
    expect(mockClaimNewSkillBonus).toHaveBeenCalledWith(
      expect.objectContaining({ playerUid: "player-uid", rootChoreId: "chore-1" }),
    );
    expect(mockEmitFamilyActivity).toHaveBeenCalledWith(
      expect.objectContaining({ newSkillBonusAwarded: true, newSkillBonusAmount: 5 }),
    );
  });

  it("does not award again when the player already completed this chore", async () => {
    mockClaimNewSkillBonus.mockResolvedValue({ firstTime: false });

    const response = await completeChore();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockApplyWalletDelta).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "new_skill_bonus" }),
    );
    // The normal chore payout still happens.
    expect(mockApplyWalletDelta).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "player-uid", reason: "chore_complete" }),
    );
  });

  it("does not award when the chore has New Skill turned off", async () => {
    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/player-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/chores/chore-1") {
        return {
          fields: {
            title: "Make bed",
            assigneeId: "player-uid",
            source: "manual",
            googleTaskOwnerUid: "",
            coinValue: 10,
            details: "",
            requireApproval: false,
            newSkillEnabled: false,
            recurrenceType: "none",
            recurrenceInterval: 0,
            recurrenceUnit: "",
            status: "Open",
          },
        };
      }
      if (path === "families/family-1/members/player-uid") {
        return {
          fields: { uid: "player-uid", email: "player@example.com", role: "player", deleted: false },
        };
      }
      if (path === "families/family-1/members/player@example.com") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      if (path === "users/player-uid/achievementState/state") {
        throw new Error("FIRESTORE_HTTP_404");
      }
      throw new Error(`Unexpected getDocument path: ${path}`);
    });

    const response = await completeChore();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockClaimNewSkillBonus).not.toHaveBeenCalled();
    expect(mockApplyWalletDelta).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "new_skill_bonus" }),
    );
  });
});

describe("PATCH /api/chores/[choreId] new skill bonus at approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (session, callback) => {
      const data = await callback("id-token");
      return { data, session, refreshed: false };
    });
    mockPatchDocument.mockResolvedValue(undefined);
    mockCommitWrites.mockResolvedValue(undefined);
    mockApplyWalletDelta.mockResolvedValue(15);
    mockEmitFamilyActivity.mockResolvedValue(undefined);
    mockPublishFamilyActivity.mockResolvedValue(undefined);
    mockSyncGoogleTasksForUser.mockResolvedValue(undefined);

    mockGetSessionFromRequest.mockReturnValue({
      uid: "admin-uid",
      memberId: "admin-uid",
      email: "admin@example.com",
      name: "Parent",
      firebaseIdToken: "id-token",
      firebaseRefreshToken: "refresh-token",
    });
    mockGetDocument.mockImplementation(async (path: string) => {
      if (path === "users/admin-uid") {
        return { fields: { familyIds: ["family-1"] } };
      }
      if (path === "families/family-1/chores/chore-1") {
        return {
          fields: {
            title: "Wash dishes",
            assigneeId: "player-uid",
            source: "manual",
            googleTaskOwnerUid: "",
            coinValue: 10,
            details: "",
            requireApproval: true,
            recurrenceType: "none",
            recurrenceInterval: 0,
            recurrenceUnit: "",
            status: "Submitted",
          },
        };
      }
      if (path === "families/family-1/members/admin-uid") {
        return { fields: { uid: "admin-uid", email: "admin@example.com", role: "admin", deleted: false } };
      }
      if (path === "families/family-1/members/admin@example.com" || path === "families/family-1/members/player-uid") {
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
            fields: { uid: "player-uid", email: "player@example.com", role: "player", deleted: false },
          },
        ];
      }
      if (path === "users/player-uid/achievements") {
        return [];
      }
      throw new Error(`Unexpected listDocuments path: ${path}`);
    });
  });

  it("awards the bonus at approval time, and a duplicate approval does not double-award", async () => {
    const { PATCH } = await import("./[choreId]/route");
    const approve = () =>
      PATCH(
        new Request("http://localhost/api/chores/chore-1", {
          method: "PATCH",
          body: JSON.stringify({ action: "approve" }),
        }) as never,
        { params: Promise.resolve({ choreId: "chore-1" }) },
      );

    mockClaimNewSkillBonus.mockResolvedValueOnce({ firstTime: true });
    const first = await approve();
    expect(first.status).toBe(200);
    expect(mockApplyWalletDelta).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "player-uid", delta: 5, reason: "new_skill_bonus" }),
    );

    // A replayed/duplicate approval: the claim record already exists, so the
    // idempotent claim returns firstTime=false and no second bonus is paid.
    mockApplyWalletDelta.mockClear();
    mockClaimNewSkillBonus.mockResolvedValueOnce({ firstTime: false });
    const second = await approve();
    expect(second.status).toBe(200);
    expect(mockApplyWalletDelta).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "new_skill_bonus" }),
    );
  });
});
