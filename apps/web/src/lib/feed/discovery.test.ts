import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryViewerContext } from "@/lib/discovery/types";

const { mockAdminRunQueryAt, mockListFamilyFriends, mockRunQuery } = vi.hoisted(() => ({
  mockAdminRunQueryAt: vi.fn(),
  mockListFamilyFriends: vi.fn(),
  mockRunQuery: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({ adminRunQueryAt: mockAdminRunQueryAt }));
vi.mock("@/lib/family-friends/repository", () => ({
  listFamilyFriends: mockListFamilyFriends,
}));
vi.mock("@/lib/firestore/rest", () => ({
  runQuery: mockRunQuery,
  readString: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "string" ? String(fields[key]) : "",
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) =>
    Array.isArray(fields?.[key]) ? (fields[key] as string[]) : [],
  readTimestamp: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "string" ? String(fields[key]) : "",
}));

import { loadVisibleFeedTimestampsForViewer } from "@/lib/feed/discovery";

const context: DiscoveryViewerContext = {
  uid: "child-1",
  memberId: "child-1",
  email: "child@example.com",
  viewerRole: "player",
  familyId: "family-1",
  idToken: "token",
  locale: "en-US",
  aliases: ["child-1", "child@example.com"],
};

describe("loadVisibleFeedTimestampsForViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFamilyFriends.mockResolvedValue([{ familyId: "friend-1", familyName: "Friends" }]);
    mockRunQuery.mockResolvedValue([
      {
        fields: {
          kind: "chore_completed",
          actorUid: "child-1",
          relatedIds: [],
          createdAt: "2026-08-01T10:00:00.000Z",
        },
      },
      {
        fields: {
          kind: "chore_completed",
          actorUid: "sibling-1",
          relatedIds: ["sibling-1"],
          createdAt: "2026-08-01T10:01:00.000Z",
        },
      },
      {
        fields: {
          kind: "chore_deleted",
          actorUid: "child-1",
          createdAt: "2026-08-01T10:02:00.000Z",
        },
      },
    ]);
    mockAdminRunQueryAt.mockResolvedValue([
      { fields: { kind: "routine_completed", createdAt: "2026-08-01T11:00:00.000Z" } },
      { fields: { kind: "chore_rejected", createdAt: "2026-08-01T11:01:00.000Z" } },
      { fields: { kind: "family_reward_created", createdAt: "2026-08-01T11:02:00.000Z" } },
    ]);
  });

  it("counts only viewer-visible family events and shareable friend events", async () => {
    await expect(loadVisibleFeedTimestampsForViewer(context)).resolves.toEqual([
      "2026-08-01T10:00:00.000Z",
      "2026-08-01T11:00:00.000Z",
    ]);
  });

  it("keeps the family feed count when friend lookup is unavailable", async () => {
    mockListFamilyFriends.mockRejectedValueOnce(new Error("ADMIN_CREDENTIALS_UNAVAILABLE"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(loadVisibleFeedTimestampsForViewer(context)).resolves.toEqual([
      "2026-08-01T10:00:00.000Z",
    ]);

    consoleError.mockRestore();
  });
});
