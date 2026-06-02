import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdminGetDocument } = vi.hoisted(() => ({
  mockAdminGetDocument: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mockAdminGetDocument,
}));

import { loadPublicRequestedChanges } from "@/lib/support/public-requests";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requests: [
          {
            id: "req-public",
            type: "bug",
            publicTitle: "Public curated title",
            publicDescription: "Public curated description",
            publicStatus: "planned",
            publicPublishedAt: "2026-06-02T12:00:00.000Z",
            publicUpdatedAt: "2026-06-02T12:00:00.000Z",
            upvoteCount: 3,
            downvoteCount: 0,
            score: 3,
            createdByEmail: "parent@example.com",
            familyId: "private-family",
            description: "Private diagnostic details",
          },
        ],
      }),
    }),
  );
  mockAdminGetDocument.mockRejectedValue(new Error("FIRESTORE_ADMIN_HTTP_404"));
});

describe("public requested changes", () => {
  it("loads curated public fields from the public bucket JSON for logged-out users", async () => {
    const result = await loadPublicRequestedChanges({});
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.googleapis.com/assets-family-chores/change-log/requested-changes.json",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      id: "req-public",
      publicTitle: "Public curated title",
      publicDescription: "Public curated description",
      upvoteCount: 3,
      viewerVote: null,
      canVote: false,
    });
    expect(JSON.stringify(result)).not.toContain("parent@example.com");
    expect(JSON.stringify(result)).not.toContain("Private diagnostic details");
    expect(JSON.stringify(result)).not.toContain("private-family");
  });

  it("returns an empty page when the bucket JSON is unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response);
    const result = await loadPublicRequestedChanges({});
    expect(result.requests).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it("includes viewer vote state on a best-effort basis for authenticated users", async () => {
    mockAdminGetDocument.mockResolvedValueOnce({ fields: { value: { integerValue: "1" } } });
    const result = await loadPublicRequestedChanges({ viewerUid: "u1" });
    expect(mockAdminGetDocument).toHaveBeenCalledWith("votes/public_support_request*req-public*u1");
    expect(result.requests[0].viewerVote).toBe(1);
    expect(result.requests[0].canVote).toBe(true);
  });
});

