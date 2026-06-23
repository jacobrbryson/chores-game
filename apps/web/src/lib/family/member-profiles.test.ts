import { beforeEach, describe, expect, it, vi } from "vitest";

const listFamilyAwardClaims = vi.fn();
const adminGetDocument = vi.fn();
const adminListAllDocuments = vi.fn();
const getDocument = vi.fn();
const listAllDocuments = vi.fn();

vi.mock("@/lib/family/award-claims", () => ({
  listFamilyAwardClaims: (...args: unknown[]) => listFamilyAwardClaims(...args),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: (...args: unknown[]) => adminGetDocument(...args),
  adminListAllDocuments: (...args: unknown[]) => adminListAllDocuments(...args),
}));

vi.mock("@/lib/firestore/rest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/firestore/rest")>("@/lib/firestore/rest");
  return {
    ...actual,
    getDocument: (...args: unknown[]) => getDocument(...args),
    listAllDocuments: (...args: unknown[]) => listAllDocuments(...args),
  };
});

vi.mock("@/lib/family/member-access", () => ({
  getViewerFamilyContext: vi.fn(async () => ({
    familyId: "family-1",
    familyName: "Home Base",
    viewerRole: "admin",
    members: [
      {
        id: "child-1",
        uid: "child-uid",
        name: "Pip",
        email: "pip@example.com",
        role: "player",
        status: "active",
        resolvedLocale: "en-US",
        selectedConfettiOptionId: "confetti_member",
        dashboardPrimaryColor: "#123456",
      },
    ],
  })),
  resolveFamilyMemberByIdentifier: vi.fn((members: Array<{ id: string }>, identifier: string) =>
    members.find((member) => member.id === identifier) ?? null,
  ),
  canViewerAccessFamilyMember: vi.fn(() => true),
}));

vi.mock("@/lib/store/catalog", () => ({
  DEFAULT_COLOR_THEME_OPTION_ID: "theme_default",
  DEFAULT_CONFETTI_OPTION_ID: "confetti_default",
  findColorThemeOptionById: vi.fn((id: string) =>
    id === "theme_default"
      ? {
          id,
          label: "Cobalt Sky",
          theme: { primary: "#0072b2", secondary: "#56b4e9", tertiary: "#1b2a41" },
        }
      : null,
  ),
  findConfettiOptionById: vi.fn((id: string) => {
    if (id === "confetti_default") {
      return { id, label: "No confetti", confetti: { colors: ["#cbd5e1", "#94a3b8", "#e2e8f0"] } };
    }
    if (id === "confetti_user") {
      return { id, label: "Starfall", confetti: { colors: ["#111111", "#222222", "#333333"] } };
    }
    if (id === "confetti_member") {
      return { id, label: "Member Burst", confetti: { colors: ["#444444", "#555555", "#666666"] } };
    }
    return null;
  }),
  findStoreOptionByValue: vi.fn(() => null),
}));

vi.mock("@/lib/theme/member-primary-color", () => ({
  resolveMemberPrimaryColor: vi.fn((value: string | undefined) => value || "#0072b2"),
}));

vi.mock("@/lib/items/catalog", () => ({
  findGameItemById: vi.fn((id: string) => (id === "sword" ? { name: "Sword" } : null)),
}));

vi.mock("@/lib/items/owned-items", () => ({
  buildOwnedItemsSummary: vi.fn((input: {
    inventoryByItemId: Map<string, { quantity: number }>;
    paidValueByItemId: Map<string, number>;
    acquisitionLabelByItemId: Map<string, string>;
  }) =>
    Array.from(input.inventoryByItemId.entries()).map(([itemId, entry]) => ({
      id: itemId,
      name: itemId,
      description: "",
      image: "",
      category: "inventory",
      quantity: entry.quantity,
      source: "inventory" as const,
      paidValue: input.paidValueByItemId.get(itemId) ?? 0,
      acquisitionLabel: input.acquisitionLabelByItemId.get(itemId) ?? "",
    })),
  ),
}));

import { loadFamilyMemberProfileData } from "@/lib/family/member-profiles";
import { integerField, stringArrayField, stringField, timestampField } from "@/lib/firestore/rest";

function doc(name: string, fields: Record<string, unknown>) {
  return {
    name,
    fields,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listFamilyAwardClaims.mockResolvedValue([]);
  getDocument.mockImplementation(async (path: string) => {
    if (path === "users/child-uid") {
      throw new Error("FIRESTORE_HTTP_403_PERMISSION_DENIED");
    }
    throw new Error(`Unexpected getDocument path: ${path}`);
  });
  listAllDocuments.mockImplementation(async (path: string) => {
    if (path === "users/child-uid/inventory" || path === "users/child-uid/walletLedger") {
      throw new Error("FIRESTORE_HTTP_403_PERMISSION_DENIED");
    }
    throw new Error(`Unexpected listAllDocuments path: ${path}`);
  });
  adminGetDocument.mockResolvedValue(
    doc("users/child-uid", {
      selectedConfettiOptionId: stringField("confetti_user"),
      ownedStoreOptionIds: stringArrayField(["theme_default"]),
    }),
  );
  adminListAllDocuments.mockImplementation(async (path: string) => {
    if (path === "users/child-uid/inventory") {
      return [
        doc("users/child-uid/inventory/sword", {
          itemId: stringField("sword"),
          quantity: integerField(2),
          createdAt: timestampField("2026-06-20T00:00:00.000Z"),
        }),
      ];
    }
    if (path === "users/child-uid/walletLedger") {
      return [
        doc("users/child-uid/walletLedger/1", {
          reason: stringField("store_purchase"),
          itemId: stringField("sword"),
          debitAmount: integerField(25),
        }),
      ];
    }
    throw new Error(`Unexpected adminListAllDocuments path: ${path}`);
  });
});

describe("loadFamilyMemberProfileData", () => {
  it("falls back to admin reads for managed user profile data when Firestore rules block viewer-token reads", async () => {
    const result = await loadFamilyMemberProfileData({
      viewerUid: "parent-uid",
      viewerEmail: "parent@example.com",
      memberIdentifier: "child-1",
      idToken: "token",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.profile.member.id).toBe("child-1");
    expect(result.profile.confetti.name).toBe("Member Burst");
    expect(result.profile.ownedItems).toHaveLength(1);
    expect(result.profile.ownedItems[0]).toMatchObject({
      id: "sword",
      quantity: 2,
      paidValue: 25,
      acquisitionLabel: "Store purchase",
    });
    expect(adminGetDocument).toHaveBeenCalledWith("users/child-uid");
    expect(adminListAllDocuments).toHaveBeenCalledWith("users/child-uid/inventory", { cap: 500 });
    expect(adminListAllDocuments).toHaveBeenCalledWith("users/child-uid/walletLedger", { cap: 500 });
  });
});
