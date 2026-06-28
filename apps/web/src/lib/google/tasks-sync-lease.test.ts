import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDocument, mockCommitWrites } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockCommitWrites: vi.fn(),
}));

vi.mock("@/lib/firestore/rest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/firestore/rest")>(
    "@/lib/firestore/rest",
  );
  return {
    ...actual,
    getDocument: mockGetDocument,
    commitWrites: mockCommitWrites,
  };
});

import {
  acquireGoogleTasksSyncLease,
  releaseGoogleTasksSyncLease,
} from "./tasks-sync-lease";

describe("Google Tasks sync lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitWrites.mockResolvedValue(undefined);
  });

  it("claims an expired lease using the user document update time", async () => {
    mockGetDocument.mockResolvedValue({
      updateTime: "2026-06-28T12:00:00.000Z",
      fields: {
        googleTasksSyncLeaseId: { stringValue: "old" },
        googleTasksSyncLeaseExpiresAt: { timestampValue: "2026-06-28T11:59:00.000Z" },
      },
    });

    const leaseId = await acquireGoogleTasksSyncLease({
      uid: "kid-1",
      idToken: "token",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(leaseId).toBeTruthy();
    expect(mockCommitWrites).toHaveBeenCalledOnce();
    expect(mockCommitWrites.mock.calls[0][0][0].update.currentDocument).toEqual({
      updateTime: "2026-06-28T12:00:00.000Z",
    });
  });

  it("skips while another non-expired sync owns the lease", async () => {
    mockGetDocument.mockResolvedValue({
      updateTime: "2026-06-28T12:00:00.000Z",
      fields: {
        googleTasksSyncLeaseId: { stringValue: "active" },
        googleTasksSyncLeaseExpiresAt: { timestampValue: "2026-06-28T12:05:00.000Z" },
      },
    });

    await expect(
      acquireGoogleTasksSyncLease({
        uid: "kid-1",
        idToken: "token",
        now: new Date("2026-06-28T12:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(mockCommitWrites).not.toHaveBeenCalled();
  });

  it("treats a concurrent compare-and-set loss as an active sync", async () => {
    mockGetDocument.mockResolvedValue({
      updateTime: "2026-06-28T12:00:00.000Z",
      fields: {},
    });
    mockCommitWrites.mockRejectedValue(new Error("FIRESTORE_HTTP_400_FAILED_PRECONDITION"));

    await expect(
      acquireGoogleTasksSyncLease({ uid: "kid-1", idToken: "token" }),
    ).resolves.toBeNull();
  });

  it("does not release a lease now owned by a newer sync", async () => {
    mockGetDocument.mockResolvedValue({
      updateTime: "2026-06-28T12:01:00.000Z",
      fields: { googleTasksSyncLeaseId: { stringValue: "new-owner" } },
    });

    await releaseGoogleTasksSyncLease({
      uid: "kid-1",
      idToken: "token",
      leaseId: "old-owner",
    });

    expect(mockCommitWrites).not.toHaveBeenCalled();
  });
});
