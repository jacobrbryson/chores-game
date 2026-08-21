import type { SessionUser } from "@/lib/auth/session";
import { buildIdpUserAuthFields } from "@/lib/auth/idp-user-fields";
import {
  getDocument,
  patchDocument,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { DEFAULT_LOCALE } from "@/lib/locale";

/**
 * Links a signed-in user to their primary family, creating `users/{uid}` if it
 * does not exist yet.
 *
 * Sign-in no longer writes the user document when the account has no family
 * (see `upsertIdpUser`), so this is the first write for anyone who reaches a
 * family through onboarding or an invite. That makes the create-vs-update
 * distinction load-bearing:
 *
 *   - update: the three-field family patch is enough, and is what
 *     `isValidSelfUserUpdate` expects.
 *   - create: `isValidSelfUserCreate` rejects a partial document. The write has
 *     to carry the full auth-field shape, and because `familyIds` is present the
 *     rules additionally require `requestedUserRoleMatchesMembership` — the role
 *     written here must equal the role on `families/{familyId}/members/{uid}`,
 *     and that member document must already exist and be active.
 *
 * Callers must therefore write the member document *before* calling this, and
 * pass the member's role rather than the (possibly stale) session role.
 */
export async function linkUserPrimaryFamily(input: {
  uid: string;
  familyId: string;
  /** Role on the family member document — not the pre-join session role. */
  role: "admin" | "player";
  session: Pick<SessionUser, "email" | "name" | "picture" | "locale" | "provider">;
  idToken: string;
}) {
  const { uid, familyId, role, session, idToken } = input;
  const now = new Date().toISOString();

  let exists = true;
  try {
    await getDocument(`users/${uid}`, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
    exists = false;
  }

  if (exists) {
    await patchDocument(
      `users/${uid}`,
      {
        uid: stringField(uid),
        familyIds: stringArrayField([familyId]),
        lastFamilyUpdateAt: timestampField(now),
      },
      idToken,
      ["familyIds", "lastFamilyUpdateAt", "uid"],
    );
    return;
  }

  // Sessions issued before `provider` was added to the cookie do not carry it.
  // Those accounts always have a user document already (sign-in wrote one), so
  // they take the update branch above; falling back here keeps the join from
  // hard-failing if that assumption ever breaks.
  const provider = session.provider ?? "google";
  if (!session.provider) {
    console.warn("[USER_LINK] session missing provider; defaulting to google", { uid });
  }

  const fields = buildIdpUserAuthFields({
    uid,
    role,
    locale: session.locale || DEFAULT_LOCALE,
    email: session.email ?? "",
    displayName: session.name ?? "",
    photoUrl: session.picture ?? "",
    provider,
    familyId,
    now,
  });
  await patchDocument(`users/${uid}`, fields, idToken, Object.keys(fields));
}
