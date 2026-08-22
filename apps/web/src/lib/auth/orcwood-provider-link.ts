// Records a Family Chores sign-in in the shared Orcwood provider index.
//
// orcwood-api resolves every account through `orcwoodProviderLinks`: a Google
// `sub` maps to exactly one uid there, and since it stopped calling
// signInWithIdp that lookup is the only one its Google path performs.
//
// Family Chores still signs in through signInWithIdp, so Firebase assigns the
// uid on this side. Unless that assignment is recorded in the shared index, a
// user who signs up in Family Chores first is invisible to orcwood.com — which
// would then allocate them a second uid and a second account, splitting one
// person across two.
//
// Writes go through admin credentials because the collection is closed to the
// client SDK entirely; a user token cannot touch it.

import { adminCreateDocument } from "@/lib/firestore/admin";
import { stringField, timestampField } from "@/lib/firestore/rest";

const PROVIDER_LINKS = "orcwoodProviderLinks";

/** Providers that exist on both sides of the index. */
export type OrcwoodLinkProvider = "google" | "apple";

/**
 * The document id for a provider identity.
 *
 * This format is an invariant shared with `providerLinkId` in
 * orcwood-api/src/lib/accounts/store.ts — the two services must derive the
 * same id from the same identity or neither can find the other's writes. The
 * subject is encoded because Firestore ids cannot contain "/" and a provider
 * subject is opaque vendor data.
 */
export function orcwoodProviderLinkId(provider: OrcwoodLinkProvider, subject: string): string {
  return `${provider}__${encodeURIComponent(subject)}`;
}

/**
 * Claims the link for a signed-in identity, if it is not already claimed.
 *
 * Best-effort on purpose: a failure here must not cost the user their sign-in.
 * The index is repairable — orcwood-api's backfill script rebuilds it from the
 * Auth pool and is safe to re-run — so a dropped write is a gap to reconcile
 * later, not a broken account.
 *
 * An existing link is left exactly as it is. If one somehow points at a
 * different uid, that is a duplicate account, and choosing a winner is not a
 * decision to make inside a sign-in request; the backfill script reports those
 * as conflicts.
 */
export async function claimOrcwoodProviderLinkBestEffort(input: {
  provider: OrcwoodLinkProvider;
  subject: string;
  uid: string;
}): Promise<void> {
  if (!input.subject || !input.uid) return;

  try {
    await adminCreateDocument(PROVIDER_LINKS, orcwoodProviderLinkId(input.provider, input.subject), {
      uid: stringField(input.uid),
      provider: stringField(input.provider),
      subject: stringField(input.subject),
      createdAt: timestampField(new Date().toISOString()),
    });
  } catch (error) {
    // ALREADY_EXISTS is the expected outcome of every sign-in after the first.
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.includes("409") || /ALREADY_EXISTS/i.test(reason)) return;
    console.warn("[ORCWOOD_PROVIDER_LINK_SKIPPED]", {
      provider: input.provider,
      uid: input.uid,
      reason,
    });
  }
}
