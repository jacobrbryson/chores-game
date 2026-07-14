import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdminGetDocument, mockAdminCommitWrites } = vi.hoisted(() => ({
  mockAdminGetDocument: vi.fn(),
  mockAdminCommitWrites: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mockAdminGetDocument,
  adminCommitWrites: mockAdminCommitWrites,
}));

import { applyAdminWalletDelta } from "@/lib/economy/wallet";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
  mockAdminGetDocument.mockResolvedValue({
    name: "users/child-1",
    updateTime: "2026-07-14T11:00:00.000Z",
    fields: { walletBalance: { integerValue: "75" } },
  });
  mockAdminCommitWrites.mockResolvedValue({});
});

describe("applyAdminWalletDelta", () => {
  it("atomically debits the selected member and writes an auditable ledger entry", async () => {
    await expect(applyAdminWalletDelta({
      uid: "child-1",
      delta: -30,
      reason: "store_purchase",
      itemId: "movie-night",
    })).resolves.toBe(45);

    const writes = mockAdminCommitWrites.mock.calls[0][0];
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      update: {
        path: "users/child-1",
        fields: { walletBalance: { integerValue: "45" } },
        currentDocument: { updateTime: "2026-07-14T11:00:00.000Z" },
      },
    });
    expect(writes[1].update.path).toMatch(/^users\/child-1\/walletLedger\//);
    expect(writes[1].update).toMatchObject({
      fields: {
        reason: { stringValue: "store_purchase" },
        debitAmount: { integerValue: "30" },
        balanceAfter: { integerValue: "45" },
        itemId: { stringValue: "movie-night" },
      },
      currentDocument: { exists: false },
    });
  });

  it("blocks a redemption that would make the member wallet negative", async () => {
    mockAdminGetDocument.mockResolvedValue({
      name: "users/child-1",
      fields: { walletBalance: { integerValue: "10" } },
    });

    await expect(applyAdminWalletDelta({
      uid: "child-1",
      delta: -30,
      reason: "store_purchase",
      itemId: "movie-night",
    })).rejects.toThrow("WALLET_NEGATIVE_BLOCKED");
    expect(mockAdminCommitWrites).not.toHaveBeenCalled();
  });

  it("commits the award grant in the same transaction as the wallet debit", async () => {
    await applyAdminWalletDelta({
      uid: "child-1",
      delta: -30,
      reason: "store_purchase",
      itemId: "movie-night",
      additionalWrites: [{
        update: {
          path: "families/family-1/awardClaims/claim-1",
          fields: { status: { stringValue: "unclaimed" } },
          currentDocument: { exists: false },
        },
      }],
    });

    const writes = mockAdminCommitWrites.mock.calls[0][0];
    expect(writes).toHaveLength(3);
    expect(writes[2]).toMatchObject({
      update: {
        path: "families/family-1/awardClaims/claim-1",
        fields: { status: { stringValue: "unclaimed" } },
        currentDocument: { exists: false },
      },
    });
  });

  it("re-reads the balance and retries after a concurrent update conflict", async () => {
    mockAdminCommitWrites
      .mockRejectedValueOnce(new Error("FIRESTORE_ADMIN_HTTP_409_ABORTED"))
      .mockResolvedValueOnce({});

    await expect(applyAdminWalletDelta({
      uid: "child-1",
      delta: -30,
      reason: "store_purchase",
      itemId: "movie-night",
    })).resolves.toBe(45);

    expect(mockAdminGetDocument).toHaveBeenCalledTimes(2);
    expect(mockAdminCommitWrites).toHaveBeenCalledTimes(2);
  });
});
