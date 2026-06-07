import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryViewerContext } from "@/lib/discovery/types";

const { mockCreateOrReplaceDocument, mockListDocuments } = vi.hoisted(() => ({
  mockCreateOrReplaceDocument: vi.fn(),
  mockListDocuments: vi.fn(),
}));

vi.mock("@/lib/firestore/rest", () => ({
  createOrReplaceDocument: mockCreateOrReplaceDocument,
  listDocuments: mockListDocuments,
  documentIdFromName: (name: string) => name.split("/").pop() ?? "",
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) => Boolean(fields?.[key]),
  readString: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "string" ? String(fields[key]) : "",
  readStringArray: (fields: Record<string, unknown> | undefined, key: string) =>
    Array.isArray(fields?.[key]) ? (fields?.[key] as string[]) : [],
  readTimestamp: (fields: Record<string, unknown> | undefined, key: string) =>
    typeof fields?.[key] === "string" ? String(fields[key]) : "",
  stringField: (value: string) => value,
  timestampField: (value: string) => value,
}));

vi.mock("@/lib/quests/service", () => ({
  listQuestDefinitionsForViewer: vi.fn(async () => []),
}));

vi.mock("@/lib/change-log", () => ({
  getChangeLogEntries: vi.fn(() => [{ date: "2026-06-06" }, { date: "2026-06-05" }]),
}));

import {
  getDiscoverySummaryForViewer,
  markDiscoverySectionSeen,
} from "@/lib/discovery/service";

function buildContext(overrides: Partial<DiscoveryViewerContext> = {}): DiscoveryViewerContext {
  return {
    uid: "player-1",
    memberId: "player-1",
    email: "player@example.com",
    viewerRole: "player",
    familyId: "fam-1",
    idToken: "token-parent",
    locale: "en-US",
    aliases: ["player-1", "player@example.com"],
    ...overrides,
  };
}

describe("markDiscoverySectionSeen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes seen-state under the active profile and records the profile identity", async () => {
    await markDiscoverySectionSeen(buildContext(), "chores", "2026-06-06T00:00:00.000Z");
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(1);
    const [path, fields] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(path).toBe("users/player-1/discoveryState/chores");
    expect(fields.sectionKey).toBe("chores");
    expect(fields.seenByUid).toBe("player-1");
  });

  it("encodes nested store category keys path-safely", async () => {
    await markDiscoverySectionSeen(buildContext(), "store:customize_avatar");
    const [path] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(path).toBe("users/player-1/discoveryState/store__customize_avatar");
  });

  it("rejects a player marking an admin-only section seen", async () => {
    await expect(
      markDiscoverySectionSeen(buildContext({ viewerRole: "player" }), "community_awards"),
    ).rejects.toThrow(/DISCOVERY_SECTION_FORBIDDEN/);
    expect(mockCreateOrReplaceDocument).not.toHaveBeenCalled();
  });

  it("keeps switched-child discovery state separate from the parent's", async () => {
    await markDiscoverySectionSeen(
      buildContext({ uid: "parent-1", memberId: "parent-1", viewerRole: "admin" }),
      "chores",
    );
    await markDiscoverySectionSeen(
      buildContext({ uid: "child-1", memberId: "child-1" }),
      "chores",
    );
    const paths = mockCreateOrReplaceDocument.mock.calls.map((call) => call[0]);
    expect(paths).toContain("users/parent-1/discoveryState/chores");
    expect(paths).toContain("users/child-1/discoveryState/chores");
  });
});

describe("getDiscoverySummaryForViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDocuments.mockImplementation(async (path: string) => {
      if (path.endsWith("/discoveryState")) {
        return []; // never seen → everything new
      }
      if (path === "families/fam-1/chores") {
        return [
          {
            name: "n/chores/c1",
            fields: { createdAt: "2026-06-02T00:00:00.000Z", status: "Open", assigneeId: "player-1", assigneeIds: [] },
          },
          {
            name: "n/chores/c2",
            fields: { createdAt: "2026-06-02T00:00:00.000Z", status: "Open", assigneeId: "player-2", assigneeIds: [] },
          },
        ];
      }
      if (path === "families/fam-1/rewards") {
        return [
          { name: "n/rewards/r1", fields: { createdAt: "2026-06-02T00:00:00.000Z" } },
          { name: "n/rewards/r2", fields: { createdAt: "2026-06-02T00:00:00.000Z" } },
        ];
      }
      if (path === "users/player-1/achievements" || path === "users/admin-1/achievements") {
        return [];
      }
      return [];
    });
  });

  it("scopes player chore counts to the active player's own chores", async () => {
    const summary = await getDiscoverySummaryForViewer(buildContext());
    expect(summary.sections.chores.count).toBe(1); // only player-1's chore
  });

  it("counts all family chores for admins and aggregates store children into the store total", async () => {
    const summary = await getDiscoverySummaryForViewer(
      buildContext({ uid: "admin-1", memberId: "admin-1", viewerRole: "admin", aliases: ["admin-1"] }),
    );
    expect(summary.sections.chores.count).toBe(2);
    // Store top-level equals the sum of visible store items (2 family rewards).
    expect(summary.sections.store.count).toBe(2);
    expect(summary.sections.store.children?.["store:family_awards"].count).toBe(2);
  });

  it("never exposes community awards to players", async () => {
    const summary = await getDiscoverySummaryForViewer(buildContext({ viewerRole: "player" }));
    expect(summary.sections.community_awards).toBeUndefined();
  });
});
