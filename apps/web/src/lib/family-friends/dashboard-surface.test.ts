import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Family Friends dashboard surface", () => {
  it("keeps friend activity in the Feed tab instead of above the chore list", () => {
    const dashboard = readFileSync(
      path.resolve(process.cwd(), "src/components/dashboard-home.tsx"),
      "utf8",
    );
    const dashboardInvites = readFileSync(
      path.resolve(process.cwd(), "src/components/family-friends-highlights.tsx"),
      "utf8",
    );

    expect(dashboard).toContain("<FamilyFeedPanel />");
    expect(dashboard).toContain("<FamilyFriendsHighlights />");
    expect(dashboard).toContain("<DiscoveryBadge count={feedUnseenCount} />");
    expect(dashboard).toContain('useMarkDiscoverySeen(["feed"], activeTab === "feed")');
    expect(dashboardInvites).not.toContain("<FamilyFeedPanel");
  });
});
