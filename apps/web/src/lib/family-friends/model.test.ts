import { describe, expect, it } from "vitest";
import {
  canShareFriendFeedKind,
  firstNameOnly,
  friendSafeMessage,
  hashFamilyFriendToken,
  isFamilyFriendInviteExpired,
} from "./model";

describe("family friends privacy rules", () => {
  it("shares positive child activity but never rejection activity", () => {
    expect(canShareFriendFeedKind("chore_completed", "player")).toBe(true);
    expect(canShareFriendFeedKind("routine_completed", "player")).toBe(true);
    expect(canShareFriendFeedKind("chore_rejected", "admin")).toBe(false);
  });

  it("limits friend-created Family Awards to admins", () => {
    expect(canShareFriendFeedKind("family_reward_created", "admin")).toBe(true);
    expect(canShareFriendFeedKind("family_reward_created", "player")).toBe(false);
  });

  it("only exposes a friend's first name in cross-family copy", () => {
    expect(firstNameOnly("Thomas Wood Jr.")).toBe("Thomas");
    expect(friendSafeMessage("Thomas Wood Jr. made the bed.", "Thomas Wood Jr.")).toBe(
      "Thomas made the bed.",
    );
  });

  it("hashes confirmation tokens and expires stale invitations", () => {
    expect(hashFamilyFriendToken("secret")).not.toContain("secret");
    expect(isFamilyFriendInviteExpired("2026-01-01T00:00:00.000Z", Date.parse("2026-08-01"))).toBe(true);
  });
});
