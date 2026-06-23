import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdminCreateDocument } = vi.hoisted(() => ({
  mockAdminCreateDocument: vi.fn(),
}));

vi.mock("@/lib/firestore/admin", () => ({
  adminCreateDocument: mockAdminCreateDocument,
}));

import {
  ANALYTICS_EVENTS_COLLECTION,
  buildAnalyticsEventFields,
  sanitizeAnalyticsMetadata,
  trackEvent,
  trackFamilyEvent,
  trackUserEvent,
} from "@/lib/analytics/service";

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminCreateDocument.mockResolvedValue({ name: "ok" });
});

describe("buildAnalyticsEventFields", () => {
  it("produces the stable generic schema", () => {
    const now = new Date("2026-06-21T10:00:00.000Z");
    const fields = buildAnalyticsEventFields(
      { event: "chore_completed", familyId: "fam-1", userId: "user-1", role: "player", platform: "mobile" },
      now,
    );
    expect(fields.event).toEqual({ stringValue: "chore_completed" });
    expect(fields.familyId).toEqual({ stringValue: "fam-1" });
    expect(fields.userId).toEqual({ stringValue: "user-1" });
    expect(fields.role).toEqual({ stringValue: "player" });
    expect(fields.platform).toEqual({ stringValue: "mobile" });
    expect(fields.createdAt).toEqual({ timestampValue: "2026-06-21T10:00:00.000Z" });
    expect(fields.metadata).toHaveProperty("mapValue");
  });

  it("defaults platform to web and tolerates missing dimensions", () => {
    const fields = buildAnalyticsEventFields({ event: "login" });
    expect(fields.platform).toEqual({ stringValue: "web" });
    expect(fields.familyId).toEqual({ stringValue: "" });
    expect(fields.userId).toEqual({ stringValue: "" });
  });
});

describe("sanitizeAnalyticsMetadata", () => {
  it("keeps short primitives and drops sensitive keys", () => {
    const safe = sanitizeAnalyticsMetadata({
      coins: 12,
      recurring: true,
      pillar: null,
      source: "chore_completion",
      email: "child@example.com",
      childName: "Sam",
      sessionToken: "secret",
      "bad key": "x",
    });
    expect(safe).toEqual({
      coins: 12,
      recurring: true,
      pillar: null,
      source: "chore_completion",
    });
  });

  it("drops nested objects and arrays", () => {
    const safe = sanitizeAnalyticsMetadata({ nested: { a: 1 }, list: [1, 2] });
    expect(safe).toEqual({});
  });
});

describe("trackEvent", () => {
  it("writes one document to the analytics collection", async () => {
    await trackEvent({ event: "chore_completed", familyId: "fam-1", userId: "user-1" });
    expect(mockAdminCreateDocument).toHaveBeenCalledTimes(1);
    const [collection, , fields] = mockAdminCreateDocument.mock.calls[0];
    expect(collection).toBe(ANALYTICS_EVENTS_COLLECTION);
    expect(fields.event).toEqual({ stringValue: "chore_completed" });
  });

  it("never throws when the write fails (best-effort)", async () => {
    mockAdminCreateDocument.mockRejectedValue(new Error("ADMIN_CREDENTIALS_UNAVAILABLE"));
    await expect(trackEvent({ event: "login", userId: "u" })).resolves.toBeUndefined();
  });

  it("ignores an empty event name", async () => {
    await trackEvent({ event: "" });
    expect(mockAdminCreateDocument).not.toHaveBeenCalled();
  });
});

describe("trackUserEvent / trackFamilyEvent", () => {
  it("attributes a user event", async () => {
    await trackUserEvent("identity_progress_viewed", "user-9", { role: "player" });
    const [, , fields] = mockAdminCreateDocument.mock.calls[0];
    expect(fields.userId).toEqual({ stringValue: "user-9" });
    expect(fields.event).toEqual({ stringValue: "identity_progress_viewed" });
  });

  it("attributes a family event", async () => {
    await trackFamilyEvent("family_created", "fam-9");
    const [, , fields] = mockAdminCreateDocument.mock.calls[0];
    expect(fields.familyId).toEqual({ stringValue: "fam-9" });
    expect(fields.event).toEqual({ stringValue: "family_created" });
  });
});
