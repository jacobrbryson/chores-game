import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDocument, mockCreateOrReplaceDocument, mockPatchDocument } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockCreateOrReplaceDocument: vi.fn(),
  mockPatchDocument: vi.fn(),
}));

vi.mock("@/lib/firestore/rest", () => ({
  getDocument: mockGetDocument,
  createOrReplaceDocument: mockCreateOrReplaceDocument,
  patchDocument: mockPatchDocument,
  readInteger: (fields: Record<string, { integerValue?: string }> | undefined, key: string) => {
    const value = fields?.[key];
    return value?.integerValue ? Number(value.integerValue) : 0;
  },
  integerField: (value: number) => ({ integerValue: String(value) }),
  stringField: (value: string) => ({ stringValue: value }),
  timestampField: (value: string) => ({ timestampValue: value }),
}));

import { checkRateLimit, consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit/limiter";

const baseCtx = {
  action: "support_request" as const,
  familyId: "fam-1",
  uid: "user-1",
  idToken: "id-token",
  now: new Date("2026-06-01T08:00:00.000Z"),
};

function notFound() {
  return Promise.reject(new Error("FIRESTORE_HTTP_404"));
}

describe("rate limiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the support_request limits (10/user/day, 30/family/day)", () => {
    expect(RATE_LIMITS.support_request).toEqual([
      { scope: "user", limit: 10 },
      { scope: "family", limit: 30 },
    ]);
  });

  it("allows when no counters exist yet", async () => {
    mockGetDocument.mockImplementation(notFound);
    const result = await checkRateLimit(baseCtx);
    expect(result).toEqual({ allowed: true });
  });

  it("denies (user scope) when the user counter is at the limit", async () => {
    mockGetDocument.mockImplementation((path: string) => {
      if (path.includes("__user__")) {
        return Promise.resolve({ fields: { count: { integerValue: "10" } } });
      }
      return notFound();
    });
    const result = await checkRateLimit(baseCtx);
    expect(result).toEqual({ allowed: false, scope: "user", limit: 10 });
  });

  it("denies (family scope) when only the family counter is at the limit", async () => {
    mockGetDocument.mockImplementation((path: string) => {
      if (path.includes("__family__")) {
        return Promise.resolve({ fields: { count: { integerValue: "30" } } });
      }
      return notFound();
    });
    const result = await checkRateLimit(baseCtx);
    expect(result).toEqual({ allowed: false, scope: "family", limit: 30 });
  });

  it("creates fresh daily counters on first consume", async () => {
    mockGetDocument.mockImplementation(notFound);
    await consumeRateLimit(baseCtx);
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(2);
    expect(mockPatchDocument).not.toHaveBeenCalled();
    const [userPath] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(userPath).toBe(
      "families/fam-1/rateLimits/support_request__user__user-1__2026-06-01",
    );
  });

  it("increments existing counters monotonically", async () => {
    mockGetDocument.mockResolvedValue({ fields: { count: { integerValue: "3" } } });
    await consumeRateLimit(baseCtx);
    expect(mockPatchDocument).toHaveBeenCalledTimes(2);
    const [, fields] = mockPatchDocument.mock.calls[0];
    expect(fields.count).toEqual({ integerValue: "4" });
  });
});
