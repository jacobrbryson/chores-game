import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/change-log", () => ({
  getChangeLogEntryGroups: () => [
    { date: "2026-06-01" },
    { date: "2026-05-01" },
  ],
}));

import sitemap from "./sitemap";

describe("sitemap", () => {
  it("includes the public routes and change-log entries", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("https://family-chores.app/");
    expect(urls).toContain("https://family-chores.app/privacy-policy");
    expect(urls).toContain("https://family-chores.app/terms-of-service");
    expect(urls).toContain("https://family-chores.app/change-log");
    expect(urls).toContain("https://family-chores.app/change-log/2026-06-01");
    expect(urls).toContain("https://family-chores.app/change-log/2026-05-01");
  });

  it("includes the marketing SEO routes and all six chore-idea age guides", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    // /chores and /routines are session-aware: signed-out visitors get
    // public marketing pages, so they belong in the sitemap.
    expect(urls).toContain("https://family-chores.app/chores");
    expect(urls).toContain("https://family-chores.app/routines");
    expect(urls).toContain("https://family-chores.app/pillars-of-responsibility");
    for (const slug of ["5-6", "7-8", "9-10", "11-12", "13-14", "15-16"]) {
      expect(urls).toContain(`https://family-chores.app/chores/ideas/${slug}`);
    }
  });

  it("does not include auth-gated routes", async () => {
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    for (const url of urls) {
      const { pathname } = new URL(url);
      expect(pathname).not.toMatch(/^\/(rewards|resources|docs|family|support|quests|achievements|community|store|notifications|profile|my-requests|onboarding)(\/|$)/);
    }
  });
});
