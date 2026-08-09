import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListAllDocuments,
  mockListDocuments,
  mockGetDocument,
  mockPatchDocument,
  mockCreateOrReplaceDocument,
  mockListGoogleTasks,
  mockPatchGoogleTask,
  mockCreateGoogleTask,
  mockDeleteGoogleTask,
  mockResolveGoogleTaskListsForUser,
  mockUpdateGoogleTasksSyncMetadata,
  mockApplyWalletDelta,
} = vi.hoisted(() => ({
  mockListAllDocuments: vi.fn(),
  mockListDocuments: vi.fn(),
  mockGetDocument: vi.fn(),
  mockPatchDocument: vi.fn(),
  mockCreateOrReplaceDocument: vi.fn(),
  mockListGoogleTasks: vi.fn(),
  mockPatchGoogleTask: vi.fn(),
  mockCreateGoogleTask: vi.fn(),
  mockDeleteGoogleTask: vi.fn(),
  mockResolveGoogleTaskListsForUser: vi.fn(),
  mockUpdateGoogleTasksSyncMetadata: vi.fn(),
  mockApplyWalletDelta: vi.fn(),
}));

vi.mock("@/lib/firestore/rest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/firestore/rest")>(
    "@/lib/firestore/rest",
  );
  return {
    ...actual,
    listAllDocuments: mockListAllDocuments,
    listDocuments: mockListDocuments,
    getDocument: mockGetDocument,
    patchDocument: mockPatchDocument,
    createOrReplaceDocument: mockCreateOrReplaceDocument,
  };
});

vi.mock("@/lib/google/tasks-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/tasks-api")>(
    "@/lib/google/tasks-api",
  );
  return {
    ...actual,
    listGoogleTasks: mockListGoogleTasks,
    patchGoogleTask: mockPatchGoogleTask,
    createGoogleTask: mockCreateGoogleTask,
    deleteGoogleTask: mockDeleteGoogleTask,
  };
});

vi.mock("@/lib/google/tasks-link", () => ({
  resolveGoogleTaskListsForUser: mockResolveGoogleTaskListsForUser,
  updateGoogleTasksSyncMetadata: mockUpdateGoogleTasksSyncMetadata,
}));

vi.mock("@/lib/google/tasks-sync-lease", () => ({
  acquireGoogleTasksSyncLease: vi.fn().mockResolvedValue("lease-1"),
  releaseGoogleTasksSyncLease: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/economy/wallet", () => ({ applyWalletDelta: mockApplyWalletDelta }));
vi.mock("@/lib/audit/log", () => ({ writeAuditLogBestEffort: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ws/publish-family-activity", () => ({
  publishFamilyActivity: vi.fn().mockResolvedValue(undefined),
}));

import { syncGoogleTasksForUser } from "./tasks-sync";

const UID = "parent-uid";
const EMAIL = "parent@example.com";
const FAMILY = "fam-1";
const LIST = "list-1";
const CHORE_ID = "chore-1";

type DocFields = Record<string, string | number | boolean | string[]>;

function toFirestoreFields(fields: DocFields) {
  const built: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      built[key] = { arrayValue: { values: value.map((entry) => ({ stringValue: entry })) } };
    } else if (typeof value === "boolean") {
      built[key] = { booleanValue: value };
    } else if (typeof value === "number") {
      built[key] = { integerValue: String(value) };
    } else if (key.endsWith("At")) {
      built[key] = { timestampValue: value };
    } else {
      built[key] = { stringValue: value };
    }
  }
  return built;
}

function docAt(path: string, fields: DocFields) {
  return {
    name: `projects/p/databases/(default)/documents/${path}`,
    fields: toFirestoreFields(fields),
  };
}

/** A Google-mapped chore owned by the syncing user, still Open locally. */
function mappedChore(overrides: DocFields = {}) {
  return docAt(`families/${FAMILY}/chores/${CHORE_ID}`, {
    title: "Take out trash",
    status: "Open",
    assigneeId: UID,
    assigneeName: "Parent",
    details: "",
    dueDate: "2026-08-09",
    deleted: false,
    coinValue: 10,
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:00.000Z",
    source: "google_tasks",
    googleTaskId: "task-1",
    googleTaskListId: LIST,
    googleTaskOwnerUid: UID,
    ...overrides,
  });
}

/** The same task checked off in Google Tasks an hour after the local write. */
function completedRemoteTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Take out trash",
    status: "completed" as const,
    due: "2026-08-09T00:00:00.000Z",
    completed: "2026-08-09T09:00:00.000Z",
    updated: "2026-08-09T09:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

function setMembers(members: Array<{ id: string; fields: DocFields }>) {
  mockListDocuments.mockImplementation(async (path: string) => {
    if (path === `families/${FAMILY}/members`) {
      return members.map((member) => docAt(`families/${FAMILY}/members/${member.id}`, member.fields));
    }
    return [];
  });
  mockGetDocument.mockImplementation(async (path: string) => {
    const memberId = path.startsWith(`families/${FAMILY}/members/`)
      ? path.slice(`families/${FAMILY}/members/`.length)
      : "";
    const member = members.find((entry) => entry.id === memberId);
    if (!member) {
      throw new Error("FIRESTORE_HTTP_404 document not found");
    }
    return docAt(path, member.fields);
  });
}

/** Merged patch payload written to the chore doc, keyed by field name. */
function chorePatchFields(choreId = CHORE_ID) {
  const merged: Record<string, string> = {};
  for (const call of mockPatchDocument.mock.calls) {
    if (!String(call[0]).endsWith(`/chores/${choreId}`)) {
      continue;
    }
    for (const [key, value] of Object.entries(call[1] as Record<string, { stringValue?: string }>)) {
      if (typeof value?.stringValue === "string") {
        merged[key] = value.stringValue;
      }
    }
  }
  return merged;
}

describe("syncGoogleTasksForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchDocument.mockResolvedValue(undefined);
    mockCreateOrReplaceDocument.mockResolvedValue(undefined);
    mockUpdateGoogleTasksSyncMetadata.mockResolvedValue(undefined);
    mockApplyWalletDelta.mockResolvedValue(undefined);
    mockCreateGoogleTask.mockResolvedValue({ id: "task-new", title: "x", status: "needsAction" });
    mockPatchGoogleTask.mockResolvedValue({ id: "task-1", title: "x", status: "completed" });
    mockDeleteGoogleTask.mockResolvedValue(undefined);
    mockListGoogleTasks.mockResolvedValue([]);
    mockListAllDocuments.mockResolvedValue([]);
    setMembers([{ id: UID, fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } }]);

    const taskList = { id: LIST, title: "My Tasks", isDefault: true };
    mockResolveGoogleTaskListsForUser.mockResolvedValue({
      link: {
        uid: UID,
        familyId: FAMILY,
        email: EMAIL,
        displayName: "Parent",
        accountLinked: true,
        linked: true,
        linkedAt: "",
        refreshToken: "refresh",
        accessToken: "access",
        accessTokenExpiresAt: "",
        scope: "",
        selectedTaskListIds: [LIST],
        selectedTaskListTitles: ["My Tasks"],
        selectedTaskListId: LIST,
        selectedTaskListTitle: "My Tasks",
        lastSyncedAt: "",
        lastSyncStatus: "ok",
        lastSyncError: "",
      },
      taskLists: [taskList],
      selectedTaskLists: [taskList],
    });
  });

  describe("pulling a Google Tasks completion back into the app", () => {
    it("marks the chore submitted when assigneeId is the uid", async () => {
      mockListAllDocuments.mockResolvedValue([mappedChore()]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      const result = await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(result.kind).toBe("ok");
      expect(chorePatchFields().status).toBe("Submitted");
      expect(mockDeleteGoogleTask).not.toHaveBeenCalled();
    });

    // Regression: members invited by email keep an email-keyed member doc, so
    // the assignee picker stores their email in assigneeId. Comparing that to
    // the uid used to read as "reassigned to someone else", which deleted the
    // Google task and unlinked the chore instead of completing it.
    it("marks the chore submitted when assigneeId is an email-keyed member doc id", async () => {
      setMembers([{ id: EMAIL, fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } }]);
      mockListAllDocuments.mockResolvedValue([mappedChore({ assigneeId: EMAIL })]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(chorePatchFields().status).toBe("Submitted");
      expect(mockDeleteGoogleTask).not.toHaveBeenCalled();
    });

    it("marks the chore submitted when assigneeId is a member doc id that is not the uid", async () => {
      setMembers([
        { id: "member-abc", fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } },
      ]);
      mockListAllDocuments.mockResolvedValue([mappedChore({ assigneeId: "member-abc" })]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(chorePatchFields().status).toBe("Submitted");
      expect(mockDeleteGoogleTask).not.toHaveBeenCalled();
    });

    it("keeps syncing a group chore that lists the owner among its assignees", async () => {
      setMembers([
        { id: EMAIL, fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } },
        { id: "kid-member", fields: { name: "Kid", uid: "kid-uid", role: "player" } },
      ]);
      mockListAllDocuments.mockResolvedValue([
        mappedChore({ assigneeId: "", assigneeIds: [EMAIL, "kid-member"] }),
      ]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(chorePatchFields().status).toBe("Submitted");
      expect(mockDeleteGoogleTask).not.toHaveBeenCalled();
    });

    it("still unlinks a chore genuinely reassigned to another member", async () => {
      setMembers([
        { id: UID, fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } },
        { id: "kid-member", fields: { name: "Kid", uid: "kid-uid", role: "player" } },
      ]);
      mockListAllDocuments.mockResolvedValue([mappedChore({ assigneeId: "kid-member" })]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(mockDeleteGoogleTask).toHaveBeenCalledWith("access", LIST, "task-1");
      expect(chorePatchFields()).toMatchObject({ source: "manual", googleTaskId: "" });
      expect(chorePatchFields().status).toBeUndefined();
    });
  });

  describe("pushing app chores into Google Tasks", () => {
    // Regression: the same alias mismatch also stopped these chores from ever
    // reaching Google Tasks, because the push path required assigneeId === uid.
    it("pushes an unmapped chore assigned via an email-keyed member doc id", async () => {
      setMembers([{ id: EMAIL, fields: { name: "Parent", uid: UID, email: EMAIL, role: "admin" } }]);
      mockListAllDocuments.mockResolvedValue([
        mappedChore({
          assigneeId: EMAIL,
          source: "manual",
          googleTaskId: "",
          googleTaskListId: "",
          googleTaskOwnerUid: "",
        }),
      ]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(mockCreateGoogleTask).toHaveBeenCalledOnce();
      expect(chorePatchFields()).toMatchObject({
        source: "google_tasks",
        googleTaskId: "task-new",
        googleTaskListId: LIST,
        googleTaskOwnerUid: UID,
      });
    });
  });

  // The two remaining causes behind "completed in Google Tasks, still open in
  // the app". Both are known gaps, pinned here so a future fix updates these
  // expectations deliberately rather than silently changing sync behaviour.
  describe("known gaps", () => {
    it("reverts the Google completion when the local chore has a newer updatedAt", async () => {
      mockListAllDocuments.mockResolvedValue([
        mappedChore({ updatedAt: "2026-08-09T09:30:00.000Z" }),
      ]);
      mockListGoogleTasks.mockResolvedValue([completedRemoteTask()]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(chorePatchFields().status).toBeUndefined();
      expect(mockPatchGoogleTask).toHaveBeenCalledWith(
        "access",
        LIST,
        "task-1",
        expect.objectContaining({ status: "needsAction" }),
      );
    });

    it("re-creates a duplicate task when the chore points at a non-selected list", async () => {
      mockListAllDocuments.mockResolvedValue([mappedChore({ googleTaskListId: "other-list" })]);
      mockListGoogleTasks.mockResolvedValue([]);

      await syncGoogleTasksForUser({ uid: UID, idToken: "t", force: true });

      expect(chorePatchFields().status).toBeUndefined();
      expect(mockCreateGoogleTask).toHaveBeenCalledOnce();
    });
  });
});
