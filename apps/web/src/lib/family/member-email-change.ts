import { isPrivateRelayEmail, keyableEmail, normalizeEmail } from "@/lib/auth/private-relay";

/**
 * Decision logic for "an admin changes a player's email address", kept pure so
 * every guard is unit-testable without Firestore.
 *
 * Security model, and why it is shaped this way:
 *
 *  - A member's sign-in identity lives in Firebase/Google, not in this database.
 *    Editing `members/{id}.email` can therefore never move an existing account,
 *    and pretending otherwise is how you build an account-takeover bug. When the
 *    target already signs in with a real provider the new address is recorded as
 *    a *contact detail only* and their login is explicitly left alone.
 *
 *  - Only a member who has never accepted an invite can have their address
 *    re-pointed as an identity, and even then the new address does not take
 *    effect immediately: it is parked in `pendingEmail` until a fresh single-use
 *    invite code is redeemed. The old address' invite lookup is revoked at
 *    request time, so a mistyped or stale address stops being able to join
 *    straight away rather than after the new one is claimed.
 *
 *  - A managed local profile (a child who plays on a shared device and owns
 *    wallet/chore history under a local uid) is never converted into a sign-in
 *    account here. Invite redemption creates a *new* uid-keyed member and
 *    retires the old document, which would strand that history. Those members
 *    get a contact-only change plus a flag so the UI can point at the separate
 *    invite flow instead.
 */

export type MemberAccountState =
  /** Never accepted an invite; no account exists yet. Address is re-pointable. */
  | "pending_invite"
  /** Signs in with a real external provider. Identity is not ours to change. */
  | "linked_account"
  /** Local managed profile with its own history; converting it is a separate flow. */
  | "managed_local";

export type EmailChangeMode = "verification_required" | "contact_only";

export type EmailChangeRejection =
  | "invalid_email"
  | "email_unchanged"
  | "email_already_in_use"
  | "private_relay_email"
  | "target_must_be_player"
  | "cannot_change_own_email"
  | "member_not_found";

export type EmailChangePlan = {
  mode: EmailChangeMode;
  accountState: MemberAccountState;
  nextEmail: string;
  /** True when the UI should point the parent at the separate "invite to sign in" action. */
  canInviteToSignIn: boolean;
};

export type EmailChangeDecision =
  | { ok: true; plan: EmailChangePlan }
  | { ok: false; reason: EmailChangeRejection };

export function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function resolveMemberAccountState(input: {
  memberUid: string;
  /** `users/{uid}.provider`, empty when no user document exists. */
  provider: string;
}): MemberAccountState {
  if (!input.memberUid.trim()) {
    return "pending_invite";
  }
  if (input.provider === "local") {
    return "managed_local";
  }
  // Any non-local provider (google, apple, ...) is an identity we do not own.
  return input.provider ? "linked_account" : "pending_invite";
}

export type PlanEmailChangeInput = {
  requestedEmail: string;
  currentEmail: string;
  targetRole: string;
  targetDeleted: boolean;
  /** True when the target member resolves to the acting admin. */
  targetIsSelf: boolean;
  accountState: MemberAccountState;
  /** Family-visible addresses of every other active member, for collision checks. */
  otherActiveEmails: string[];
};

export function planMemberEmailChange(input: PlanEmailChangeInput): EmailChangeDecision {
  if (input.targetDeleted) {
    return { ok: false, reason: "member_not_found" };
  }
  // Deliberately players only. Re-pointing another admin's address is the
  // co-parent takeover this feature must not enable.
  if (input.targetRole !== "player") {
    return { ok: false, reason: "target_must_be_player" };
  }
  if (input.targetIsSelf) {
    return { ok: false, reason: "cannot_change_own_email" };
  }

  const nextEmail = normalizeEmail(input.requestedEmail);
  if (!nextEmail || !isLikelyEmail(nextEmail)) {
    return { ok: false, reason: "invalid_email" };
  }
  // A relay address can never be a document key, so it cannot back an invite
  // lookup and must not be set as a family-visible identity.
  if (isPrivateRelayEmail(nextEmail) || !keyableEmail(nextEmail)) {
    return { ok: false, reason: "private_relay_email" };
  }
  if (nextEmail === normalizeEmail(input.currentEmail)) {
    return { ok: false, reason: "email_unchanged" };
  }
  if (input.otherActiveEmails.some((entry) => normalizeEmail(entry) === nextEmail)) {
    return { ok: false, reason: "email_already_in_use" };
  }

  if (input.accountState === "pending_invite") {
    return {
      ok: true,
      plan: {
        mode: "verification_required",
        accountState: input.accountState,
        nextEmail,
        canInviteToSignIn: false,
      },
    };
  }

  return {
    ok: true,
    plan: {
      mode: "contact_only",
      accountState: input.accountState,
      nextEmail,
      // Only a local managed profile has a sign-in account still to gain.
      canInviteToSignIn: input.accountState === "managed_local",
    },
  };
}
