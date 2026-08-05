import { describe, expect, it } from "vitest";
import { resolveFamilyFriendInviteEmailPreference } from "@/lib/email/preferences";
import { resolveWeeklyFamilyHighlightsEmailPreference } from "@/lib/newsletters/preferences";

describe("newsletter preferences", () => {
  it("defaults weekly family highlights email to enabled when the field is missing", () => {
    expect(resolveWeeklyFamilyHighlightsEmailPreference(undefined)).toBe(true);
    expect(resolveWeeklyFamilyHighlightsEmailPreference({})).toBe(true);
  });

  it("respects an explicit opt-out value", () => {
    expect(
      resolveWeeklyFamilyHighlightsEmailPreference({
        weeklyFamilyHighlightsEmail: { booleanValue: false },
      } as any),
    ).toBe(false);
  });

  it("defaults family friend invite email to enabled when the field is missing", () => {
    expect(resolveFamilyFriendInviteEmailPreference(undefined)).toBe(true);
    expect(resolveFamilyFriendInviteEmailPreference({})).toBe(true);
  });

  it("respects an explicit family friend invite opt-out", () => {
    expect(
      resolveFamilyFriendInviteEmailPreference({
        familyFriendInviteEmail: { booleanValue: false },
      } as any),
    ).toBe(false);
  });
});
