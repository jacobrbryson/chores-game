/**
 * Apple "Hide My Email" private-relay address handling.
 *
 * When a user picks Hide My Email, Apple issues a per-app relay address like
 * `x7k2p9@privaterelay.appleid.com`. It routes real transactional mail, so it
 * is a valid *contact* address, but it is emphatically NOT the address the
 * person's family knows them by.
 *
 * Consequences enforced through this module:
 *  - A relay address must never become a Firestore document key
 *    (`members/{email}`, `inviteLookup/{email}`). Doing so manufactures junk
 *    invite documents that can never be matched by the inviting parent and that
 *    the Stale Invites panel later has to clean up.
 *  - A relay address must never be treated as the family-visible email, because
 *    a parent inviting `kid@example.com` will never see the relay value.
 *  - It may still be stored as the account's contact email and used to send
 *    transactional mail.
 */

const PRIVATE_RELAY_DOMAINS = ["privaterelay.appleid.com", "icloud.com.appleid.com"] as const;

export function normalizeEmail(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

/** True when the address is an Apple private-relay ("Hide My Email") address. */
export function isPrivateRelayEmail(value: string | undefined | null) {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) return false;
  const domain = normalized.slice(atIndex + 1);
  return PRIVATE_RELAY_DOMAINS.some(
    (relayDomain) => domain === relayDomain || domain.endsWith(`.${relayDomain}`),
  );
}

/**
 * The address that is safe to use as a document key or invite-lookup key.
 * Returns "" for relay addresses so callers fall back to uid-keyed identity.
 */
export function keyableEmail(value: string | undefined | null) {
  const normalized = normalizeEmail(value);
  return isPrivateRelayEmail(normalized) ? "" : normalized;
}

/**
 * The address the family knows the person by. Relay addresses are not it, so
 * they resolve to "" and the member's display name carries the identity.
 */
export function familyVisibleEmail(value: string | undefined | null) {
  return keyableEmail(value);
}

/**
 * The address transactional mail can be sent to. Relay addresses ARE
 * deliverable, so they are preserved here — this is the one place they survive.
 */
export function contactEmail(value: string | undefined | null) {
  return normalizeEmail(value);
}
