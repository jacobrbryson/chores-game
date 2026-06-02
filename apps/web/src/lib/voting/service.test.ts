import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdminRunQuery, mockAdminGetDocument, mockAdminCommitWrites } = vi.hoisted(() => ({
  mockAdminRunQuery: vi.fn(),
  mockAdminGetDocument: vi.fn(),
  mockAdminCommitWrites: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminRunQuery: mockAdminRunQuery,
  adminGetDocument: mockAdminGetDocument,
  adminCommitWrites: mockAdminCommitWrites,
}));

import { toggleVote } from "@/lib/voting/service";

const publicTargetDoc = {
  name: "projects/p/databases/(default)/documents/families/fam-1/supportRequests/req-1",
  fields: {
    id: { stringValue: "req-1" },
    familyId: { stringValue: "fam-1" },
    isPublic: { booleanValue: true },
    deleted: { booleanValue: false },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
  mockAdminRunQuery.mockResolvedValue([publicTargetDoc]);
  mockAdminCommitWrites.mockResolvedValue(undefined);
  mockAdminGetDocument.mockImplementation((path: string) => {
    if (path.startsWith("votes/")) {
      return Promise.reject(new Error("FIRESTORE_ADMIN_HTTP_404"));
    }
    if (path.startsWith("voteAggregates/")) {
      return Promise.resolve({
        fields: {
          upvoteCount: { integerValue: "0" },
          downvoteCount: { integerValue: "0" },
          score: { integerValue: "0" },
        },
      });
    }
    return Promise.reject(new Error("FIRESTORE_ADMIN_HTTP_404"));
  });
});

describe("generic voting service", () => {
  it("rejects invalid target types", async () => {
    const result = await toggleVote({
      targetType: "changelog_item",
      targetId: "item-1",
      value: 1,
      uid: "u1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_target_type" });
  });

  it("rejects unpublished or missing public support requests", async () => {
    mockAdminRunQuery.mockResolvedValue([]);
    const result = await toggleVote({
      targetType: "public_support_request",
      targetId: "req-1",
      value: 1,
      uid: "u1",
    });
    expect(result).toEqual({ ok: false, error: "target_not_found" });
  });

  it("creates an upvote and aggregate", async () => {
    const result = await toggleVote({
      targetType: "public_support_request",
      targetId: "req-1",
      value: 1,
      uid: "u1",
      familyId: null,
    });

    expect(result).toMatchObject({ ok: true, upvoteCount: 1, viewerVote: 1 });
    expect(mockAdminRunQuery.mock.calls[0][0].where).toEqual({
      fieldFilter: {
        field: { fieldPath: "id" },
        op: "EQUAL",
        value: { stringValue: "req-1" },
      },
    });
    const writes = mockAdminCommitWrites.mock.calls[0][0];
    expect(writes[0].update.path).toBe("votes/public_support_request*req-1*u1");
    expect(writes[0].update.fields.value).toEqual({ integerValue: "1" });
    expect(writes[1].update.path).toBe("voteAggregates/public_support_request_req-1");
    expect(writes[1].update.fields.upvoteCount).toEqual({ integerValue: "1" });
  });

  it("removes an existing upvote on second click", async () => {
    mockAdminGetDocument.mockImplementation((path: string) => {
      if (path.startsWith("votes/")) {
        return Promise.resolve({
          updateTime: "2026-06-02T11:00:00.000Z",
          fields: { value: { integerValue: "1" } },
        });
      }
      if (path.startsWith("voteAggregates/")) {
        return Promise.resolve({
          fields: {
            upvoteCount: { integerValue: "1" },
            downvoteCount: { integerValue: "0" },
            score: { integerValue: "1" },
          },
        });
      }
      return Promise.reject(new Error("FIRESTORE_ADMIN_HTTP_404"));
    });

    const result = await toggleVote({
      targetType: "public_support_request",
      targetId: "req-1",
      value: 1,
      uid: "u1",
    });

    expect(result).toMatchObject({ ok: true, upvoteCount: 0, viewerVote: null });
    const writes = mockAdminCommitWrites.mock.calls[0][0];
    expect(writes[0].delete.path).toBe("votes/public_support_request*req-1*u1");
    expect(writes[1].update.fields.upvoteCount).toEqual({ integerValue: "0" });
  });
});
