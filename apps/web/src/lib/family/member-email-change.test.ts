import { describe, expect, it } from "vitest";
import {
  planMemberEmailChange,
  resolveMemberAccountState,
  type PlanEmailChangeInput,
} from "./member-email-change";

function input(overrides: Partial<PlanEmailChangeInput> = {}): PlanEmailChangeInput {
  return {
    requestedEmail: "new@example.com",
    currentEmail: "old@example.com",
    targetRole: "player",
    targetDeleted: false,
    targetIsSelf: false,
    accountState: "pending_invite",
    otherActiveEmails: [],
    ...overrides,
  };
}

describe("resolveMemberAccountState", () => {
  it("treats a member with no uid as a pending invite", () => {
    expect(resolveMemberAccountState({ memberUid: "", provider: "" })).toBe("pending_invite");
    expect(resolveMemberAccountState({ memberUid: "   ", provider: "google" })).toBe("pending_invite");
  });

  it("treats a local provider as a managed profile", () => {
    expect(resolveMemberAccountState({ memberUid: "uid-1", provider: "local" })).toBe("managed_local");
  });

  it("treats any external provider as a linked account", () => {
    expect(resolveMemberAccountState({ memberUid: "uid-1", provider: "google" })).toBe("linked_account");
    expect(resolveMemberAccountState({ memberUid: "uid-1", provider: "apple" })).toBe("linked_account");
  });

  it("treats a uid with no user document as still pending", () => {
    expect(resolveMemberAccountState({ memberUid: "uid-1", provider: "" })).toBe("pending_invite");
  });
});

describe("planMemberEmailChange", () => {
  it("requires verification for a member who never accepted an invite", () => {
    const decision = planMemberEmailChange(input({ accountState: "pending_invite" }));
    expect(decision).toEqual({
      ok: true,
      plan: {
        mode: "verification_required",
        accountState: "pending_invite",
        nextEmail: "new@example.com",
        canInviteToSignIn: false,
      },
    });
  });

  it("only updates the contact address for a linked account", () => {
    // The sign-in identity lives with the external provider, so this must never
    // claim to have moved the account.
    const decision = planMemberEmailChange(input({ accountState: "linked_account" }));
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.mode).toBe("contact_only");
    expect(decision.plan.canInviteToSignIn).toBe(false);
  });

  it("flags a managed local profile so the UI can offer the separate invite flow", () => {
    // Redeeming an invite would create a new uid-keyed member and strand this
    // child's existing wallet/chore history, so it is not done implicitly.
    const decision = planMemberEmailChange(input({ accountState: "managed_local" }));
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.mode).toBe("contact_only");
    expect(decision.plan.canInviteToSignIn).toBe(true);
  });

  it("refuses to change another admin's address", () => {
    expect(planMemberEmailChange(input({ targetRole: "admin" }))).toEqual({
      ok: false,
      reason: "target_must_be_player",
    });
  });

  it("refuses to change the acting admin's own address", () => {
    expect(planMemberEmailChange(input({ targetIsSelf: true }))).toEqual({
      ok: false,
      reason: "cannot_change_own_email",
    });
  });

  it("refuses a deleted member", () => {
    expect(planMemberEmailChange(input({ targetDeleted: true }))).toEqual({
      ok: false,
      reason: "member_not_found",
    });
  });

  it("rejects malformed addresses", () => {
    for (const requestedEmail of ["", "   ", "nope", "no@domain", "a b@example.com"]) {
      expect(planMemberEmailChange(input({ requestedEmail })).ok).toBe(false);
    }
  });

  it("rejects an Apple private-relay address", () => {
    // A relay address can never be a document key, so it cannot back the invite
    // lookup this flow depends on.
    expect(
      planMemberEmailChange(input({ requestedEmail: "x7k2p9@privaterelay.appleid.com" })),
    ).toEqual({ ok: false, reason: "private_relay_email" });
  });

  it("rejects a no-op change regardless of case or padding", () => {
    expect(planMemberEmailChange(input({ requestedEmail: "  OLD@Example.com " }))).toEqual({
      ok: false,
      reason: "email_unchanged",
    });
  });

  it("rejects an address already held by another active member", () => {
    expect(
      planMemberEmailChange(input({ otherActiveEmails: ["sibling@example.com", "NEW@example.com"] })),
    ).toEqual({ ok: false, reason: "email_already_in_use" });
  });

  it("normalizes the accepted address", () => {
    const decision = planMemberEmailChange(input({ requestedEmail: "  NEW@Example.COM  " }));
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.nextEmail).toBe("new@example.com");
  });
});
