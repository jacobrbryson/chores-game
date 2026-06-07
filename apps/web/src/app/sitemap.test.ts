import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPublishedPublicContent: vi.fn(),
}));

vi.mock("@/lib/change-log", () => ({
  getChangeLogEntryGroups: () => [],
}));

vi.mock("@/lib/public-content/service", () => ({
  listPublishedPublicContent: mocks.listPublishedPublicContent,
}));

import sitemap from "./sitemap";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sitemap", () => {
  it("includes only published routable public content", async () => {
  mocks.listPublishedPublicContent.mockResolvedValue({
      content: [
        { type: "guide", canonicalPath: "/resources/guide", publishedAt: "2026-06-01T00:00:00.000Z", lastReviewedAt: "" },
        { type: "quest", canonicalPath: "/resources/quest", publishedAt: "2026-06-01T00:00:00.000Z", lastReviewedAt: "" },
      ],
    });
    const entries = await sitemap();
    expect(entries.map((entry) => entry.url)).toContain("https://family-chores.app/resources/guide");
    expect(entries.map((entry) => entry.url)).not.toContain("https://family-chores.app/resources/quest");
  });
});
