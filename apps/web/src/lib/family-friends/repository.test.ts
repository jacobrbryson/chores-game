import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listAll: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mocks.get,
  adminListAllDocuments: mocks.listAll,
  adminRunQuery: mocks.query,
}));

import { findTargetAdminFamily } from "./repository";

describe("findTargetAdminFamily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the indexed users collection and verifies active admin membership", async () => {
    mocks.query.mockResolvedValue([
      {
        name: "projects/test/databases/(default)/documents/users/admin-1",
        fields: {
          uid: { stringValue: "admin-1" },
          email: { stringValue: "friend@example.com" },
          displayName: { stringValue: "Friend Parent" },
          locale: { stringValue: "fr-FR" },
          familyIds: { arrayValue: { values: [{ stringValue: "family-2" }] } },
        },
      },
    ]);
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "families/family-2/members/admin-1") {
        return {
          name: `projects/test/databases/(default)/documents/${path}`,
          fields: {
            uid: { stringValue: "admin-1" },
            name: { stringValue: "Friend Parent" },
            role: { stringValue: "admin" },
            status: { stringValue: "active" },
          },
        };
      }
      return { fields: { name: { stringValue: "The Friend Family" }, defaultLocale: { stringValue: "es-US" } } };
    });

    await expect(findTargetAdminFamily("friend@example.com")).resolves.toEqual({
      familyId: "family-2",
      familyName: "The Friend Family",
      uid: "admin-1",
      name: "Friend Parent",
      email: "friend@example.com",
      locale: "es-US",
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({
      from: [{ collectionId: "users" }],
    }));
  });

  it("does not resolve a player as a target-family admin", async () => {
    mocks.query.mockResolvedValue([
      {
        name: "projects/test/databases/(default)/documents/users/player-1",
        fields: {
          familyIds: { arrayValue: { values: [{ stringValue: "family-2" }] } },
        },
      },
    ]);
    mocks.get.mockResolvedValue({
      fields: {
        role: { stringValue: "player" },
        status: { stringValue: "active" },
      },
    });

    await expect(findTargetAdminFamily("child@example.com")).resolves.toBeNull();
  });
});
