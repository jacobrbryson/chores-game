import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mobileFamilyFriendAwardCopyPath,
  mobileFamilyFriendRoutineCopyPath,
  mobileFamilyFriendInvitationRequest,
  mobileFamilyFriendInvitationPath,
  mobileFamilyFriendInviteRequest,
  mobileFamilyFriendPath,
  mobileFamilyFriendRemoveRequest,
  mobileFamilyFriendsPath,
  mobileRoutineAssignPath,
} from "./family-friends-contract";

describe("Family Friends mobile surface", () => {
  it("uses the mobile v1 endpoints for the complete relationship workflow", () => {
    expect(mobileFamilyFriendsPath).toBe("/family-friends");
    expect(mobileFamilyFriendInvitationPath("invite/one")).toBe("/family-friends/invitations/invite%2Fone");
    expect(mobileFamilyFriendPath("family/one")).toBe("/family-friends/family%2Fone");
    expect(mobileFamilyFriendAwardCopyPath).toBe("/family-friends/awards/copy");
    expect(mobileFamilyFriendRoutineCopyPath).toBe("/family-friends/routines/copy");
    expect(mobileRoutineAssignPath("routine/one")).toBe("/routines/routine%2Fone/assign");
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

  // Friend *activity* belongs to the dashboard (highlights + Feed tab); friend
  // *management* belongs to Manage Family's Friends tab, the same split web uses
  // between the dashboard and /family. Management used to sit on the mobile
  // profile screen only because Manage Family had no Friends tab yet.
  it("keeps friend activity in the Feed tab and management in Manage Family", () => {
    const appRoot = resolve(__dirname, "../..");
    const home = readFileSync(resolve(appRoot, "src/screens/HomeScreen.tsx"), "utf8");
    const dashboardInvites = readFileSync(
      resolve(appRoot, "src/components/MobileFamilyFriendsHighlights.tsx"),
      "utf8",
    );
    const profile = readFileSync(resolve(appRoot, "src/screens/ProfileScreen.tsx"), "utf8");
    const manageFamily = readFileSync(resolve(appRoot, "src/screens/ManageFamilyScreen.tsx"), "utf8");
    const app = readFileSync(resolve(appRoot, "App.tsx"), "utf8");

    expect(home).toContain("<MobileFamilyFriendsHighlights />");
    expect(home).toContain("<MobileFeedPanel");
    expect(home).toContain('<DiscoveryBadge count={feedUnseenCount} />');
    // The Feed tab marks the "feed" discovery section seen and Chores marks
    // "chores"; the Routines tab has no discovery section of its own.
    expect(home).toContain(
      'activeTab === "feed" ? "feed" : activeTab === "routines" ? "" : "chores"',
    );
    expect(dashboardInvites).not.toContain("<MobileFeedPanel");
    expect(manageFamily).toContain("<MobileFamilyFriendsManager />");
    // Exactly one management surface — it must not be duplicated on the profile.
    expect(profile).not.toContain("<MobileFamilyFriendsManager />");
    expect(app).not.toMatch(/QuestsScreen|MobileQuestLibrary|MobileQuestReader/);
  });
});
