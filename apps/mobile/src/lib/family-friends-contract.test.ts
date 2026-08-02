import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mobileFamilyFriendAwardCopyPath,
  mobileFamilyFriendInvitationRequest,
  mobileFamilyFriendInvitationPath,
  mobileFamilyFriendInviteRequest,
  mobileFamilyFriendPath,
  mobileFamilyFriendRemoveRequest,
  mobileFamilyFriendsPath,
} from "./family-friends-contract";

describe("Family Friends mobile surface", () => {
  it("uses the mobile v1 endpoints for the complete relationship workflow", () => {
    expect(mobileFamilyFriendsPath).toBe("/family-friends");
    expect(mobileFamilyFriendInvitationPath("invite/one")).toBe("/family-friends/invitations/invite%2Fone");
    expect(mobileFamilyFriendPath("family/one")).toBe("/family-friends/family%2Fone");
    expect(mobileFamilyFriendAwardCopyPath).toBe("/family-friends/awards/copy");
    expect(mobileFamilyFriendInviteRequest("parent@example.com")).toEqual({
      method: "POST",
      body: JSON.stringify({ email: "parent@example.com" }),
    });
    expect(mobileFamilyFriendInvitationRequest("accept")).toEqual({
      method: "POST",
      body: JSON.stringify({ action: "accept" }),
    });
    expect(mobileFamilyFriendInvitationRequest("resend")).toEqual({
      method: "POST",
      body: JSON.stringify({ action: "resend" }),
    });
    expect(mobileFamilyFriendInvitationRequest("cancel")).toEqual({ method: "DELETE" });
    expect(mobileFamilyFriendRemoveRequest()).toEqual({ method: "DELETE" });
  });

  it("keeps friend activity in the Feed tab and management in the mobile profile", () => {
    const appRoot = resolve(__dirname, "../..");
    const home = readFileSync(resolve(appRoot, "src/screens/HomeScreen.tsx"), "utf8");
    const dashboardInvites = readFileSync(
      resolve(appRoot, "src/components/MobileFamilyFriendsHighlights.tsx"),
      "utf8",
    );
    const profile = readFileSync(resolve(appRoot, "src/screens/ProfileScreen.tsx"), "utf8");
    const app = readFileSync(resolve(appRoot, "App.tsx"), "utf8");

    expect(home).toContain("<MobileFamilyFriendsHighlights />");
    expect(home).toContain("<MobileFeedPanel");
    expect(home).toContain('<DiscoveryBadge count={feedUnseenCount} />');
    expect(home).toContain('activeTab === "feed" ? "feed" : "chores"');
    expect(dashboardInvites).not.toContain("<MobileFeedPanel");
    expect(profile).toContain("<MobileFamilyFriendsManager />");
    expect(app).not.toMatch(/QuestsScreen|MobileQuestLibrary|MobileQuestReader/);
  });
});
