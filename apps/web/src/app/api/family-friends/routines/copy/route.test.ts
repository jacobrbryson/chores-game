import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getContext: vi.fn(),
  listFriends: vi.fn(),
  getSource: vi.fn(),
  listSourceRoutines: vi.fn(),
  listRoutines: vi.fn(),
  createRoutine: vi.fn(),
  emitActivity: vi.fn(),
  publishActivity: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mocks.getSession }));
vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: async (session: unknown, run: (token: string) => Promise<unknown>) => ({
    data: await run("id-token"),
    session,
    refreshed: false,
  }),
}));
vi.mock("@/lib/auth/session-cookie", () => ({ setSessionUserCookie: vi.fn() }));
vi.mock("@/lib/family/member-access", () => ({ getViewerFamilyContext: mocks.getContext }));
vi.mock("@/lib/family-friends/repository", () => ({ listFamilyFriends: mocks.listFriends }));
vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mocks.getSource,
  adminListAllDocuments: mocks.listSourceRoutines,
}));
vi.mock("@/lib/firestore/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firestore/rest")>();
  return {
    ...actual,
    listAllDocuments: mocks.listRoutines,
    createOrReplaceDocument: mocks.createRoutine,
  };
});
vi.mock("@/lib/notifications/events", () => ({ emitFamilyActivity: mocks.emitActivity }));
vi.mock("@/lib/ws/publish-family-activity", () => ({ publishFamilyActivity: mocks.publishActivity }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLogBestEffort: mocks.audit }));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/family-friends/routines/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function previewRequest(query = "sourceFamilyId=family-2&routineId=routine-2") {
  return new Request(`http://localhost/api/family-friends/routines/copy?${query}`);
}

describe("POST /api/family-friends/routines/copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockReturnValue({
      uid: "parent-1",
      email: "parent@example.com",
      name: "Parent",
      firebaseIdToken: "token",
    });
    mocks.getContext.mockResolvedValue({ familyId: "family-1", viewerRole: "admin" });
    mocks.listFriends.mockResolvedValue([{ familyId: "family-2" }]);
    mocks.getSource.mockResolvedValue({
      name: "projects/p/databases/(default)/documents/families/family-2/routines/routine-2",
      fields: {
        name: { stringValue: "Morning" },
        description: { stringValue: "Get ready" },
        pillar: { stringValue: "self_care" },
        stepsJson: { stringValue: JSON.stringify([{ id: "brush", title: "Brush teeth" }]) },
        completionBonusXp: { integerValue: "5" },
        completionBonusCoins: { integerValue: "2" },
        deleted: { booleanValue: false },
      },
    });
    mocks.listRoutines.mockResolvedValue([]);
    mocks.listSourceRoutines.mockResolvedValue([]);
  });

  it("copies every step after verifying an active friendship", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ sourceFamilyId: "family-2", routineId: "routine-2" }) as never);
    expect(response.status).toBe(201);
    expect(mocks.createRoutine).toHaveBeenCalledWith(
      expect.stringMatching(/^families\/family-1\/routines\//),
      expect.objectContaining({
        name: { stringValue: "Morning" },
        stepsJson: { stringValue: JSON.stringify([{ id: "brush", title: "Brush teeth" }]) },
        copiedFromFriendFamilyId: { stringValue: "family-2" },
        copiedFromFriendRoutineId: { stringValue: "routine-2" },
      }),
      "id-token",
    );
    expect(mocks.emitActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: "routine_created", routineName: "Morning" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "family_friend_routine_copied" }));
  });

  it("returns a trusted preview before the routine is copied", async () => {
    const { GET } = await import("./route");
    const response = await GET(previewRequest() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      routine: {
        id: "routine-2",
        name: "Morning",
        steps: [{ id: "brush", title: "Brush teeth" }],
      },
    });
    expect(mocks.createRoutine).not.toHaveBeenCalled();
  });

  it("persists customized chores and coin values in the copied template", async () => {
    const { POST } = await import("./route");
    const steps = [
      { id: "brush", title: "Brush teeth", coinValue: 7, requireApproval: true },
      { id: "bag", title: "Pack backpack", coinValue: 3, requireApproval: false },
    ];
    const response = await POST(
      request({ sourceFamilyId: "family-2", routineId: "routine-2", steps }) as never,
    );
    expect(response.status).toBe(201);
    expect(mocks.createRoutine).toHaveBeenCalledWith(
      expect.stringMatching(/^families\/family-1\/routines\//),
      expect.objectContaining({ stepsJson: { stringValue: JSON.stringify(steps) } }),
      "id-token",
    );
  });

  it("rejects a source family that is not currently connected", async () => {
    mocks.listFriends.mockResolvedValue([]);
    const { POST } = await import("./route");
    const response = await POST(request({ sourceFamilyId: "family-3", routineId: "routine-2" }) as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_family_friends" });
    expect(mocks.getSource).not.toHaveBeenCalled();
    expect(mocks.createRoutine).not.toHaveBeenCalled();
  });

  it("resolves legacy Feed events by routine name when they have no routine id", async () => {
    mocks.listSourceRoutines.mockResolvedValue([await mocks.getSource()]);
    const { POST } = await import("./route");
    const response = await POST(
      request({ sourceFamilyId: "family-2", routineName: "  morning  " }) as never,
    );
    expect(response.status).toBe(201);
    expect(mocks.getSource).toHaveBeenCalledTimes(1);
    expect(mocks.listSourceRoutines).toHaveBeenCalledWith("families/family-2/routines", {
      cap: 51,
    });
    expect(mocks.createRoutine).toHaveBeenCalledWith(
      expect.stringMatching(/^families\/family-1\/routines\//),
      expect.objectContaining({
        copiedFromFriendRoutineId: { stringValue: "routine-2" },
      }),
      "id-token",
    );
  });

  it("rejects player accounts", async () => {
    mocks.getContext.mockResolvedValue({ familyId: "family-1", viewerRole: "player" });
    const { POST } = await import("./route");
    const response = await POST(request({ sourceFamilyId: "family-2", routineId: "routine-2" }) as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(mocks.listFriends).not.toHaveBeenCalled();
  });
});
