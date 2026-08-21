import { writeAdminAuditLogBestEffort } from "@/lib/audit/log";
import { contactEmail, familyVisibleEmail } from "@/lib/auth/private-relay";
import { buildIdpUserAuthFields } from "@/lib/auth/idp-user-fields";
import {
  findFamilyInviteByCode,
  markFamilyInviteAccepted,
  recordFamilyInviteAttempt,
  type FamilyInviteRecord,
} from "@/lib/family/invite-repository";
import {
  evaluateFamilyInviteRedeemability,
  isValidFamilyInviteCodeShape,
  type FamilyInviteRejection,
} from "@/lib/family/invite-tokens";
import {
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminListDocuments,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import {
  boolField,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { DEFAULT_LOCALE } from "@/lib/locale";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  findColorThemeOptionById,
} from "@/lib/store/catalog";

const MAX_FAMILY_MEMBERS = 100;

export type RedeemFamilyInviteFailure =
  | FamilyInviteRejection
  | "invalid_code"
  | "already_in_another_family"
  | "family_member_limit_reached";

export type RedeemFamilyInviteResult =
  | {
      ok: true;
      familyId: string;
      familyName: string;
      role: "admin" | "player";
      memberId: string;
      /** True when the caller was already an active member of this family. */
      alreadyMember: boolean;
    }
  | { ok: false; reason: RedeemFamilyInviteFailure };

export type RedeemFamilyInviteInput = {
  code: string;
  uid: string;
  /** The signing-in account's address; may be an Apple private relay. */
  email: string;
  displayName: string;
  /** Auth-sync fields, needed when this redemption creates `users/{uid}`. */
  locale?: string;
  photoUrl?: string;
  provider?: "google" | "apple";
};

/**
 * Redeems an invite code and links the caller to the family.
 *
 * The whole point of this path is that it never compares email addresses: the
 * code is the credential. A child invited at `kid@example.com` who signs in
 * with Apple Hide My Email — or with a second Google account — reaches their
 * family through exactly the same flow as everyone else.
 *
 * Every write uses admin credentials because the caller is, by definition, not
 * yet a member of the family being joined.
 */
export async function redeemFamilyInvite(
  input: RedeemFamilyInviteInput,
): Promise<RedeemFamilyInviteResult> {
  if (!isValidFamilyInviteCodeShape(input.code)) {
    return { ok: false, reason: "invalid_code" };
  }

  const invite = await findFamilyInviteByCode(input.code);
  const redeemability = evaluateFamilyInviteRedeemability(invite);
  if (!redeemability.ok) {
    if (invite) {
      await recordFamilyInviteAttempt(invite.id, invite.attemptCount).catch(() => undefined);
      await auditRedemptionFailure(invite, input, redeemability.reason);
    }
    return { ok: false, reason: redeemability.reason };
  }

  const accepted = invite as FamilyInviteRecord;
  const now = new Date().toISOString();

  // Refuse to silently move somebody out of a family they already belong to.
  // Re-redeeming into the same family stays idempotent.
  const existingFamilyIds = await readUserFamilyIds(input.uid);
  const existingPrimaryFamilyId = existingFamilyIds[0] ?? "";
  if (existingPrimaryFamilyId && existingPrimaryFamilyId !== accepted.familyId) {
    await recordFamilyInviteAttempt(accepted.id, accepted.attemptCount).catch(() => undefined);
    await auditRedemptionFailure(accepted, input, "already_in_another_family");
    return { ok: false, reason: "already_in_another_family" };
  }

  const memberPath = `families/${accepted.familyId}/members/${input.uid}`;
  const existingMember = await tryGetDocument(memberPath);
  const alreadyMember =
    Boolean(existingMember) &&
    !readBoolean(existingMember?.fields, "deleted") &&
    readString(existingMember?.fields, "status") === "active";

  if (!alreadyMember) {
    const members = await adminListDocuments(`families/${accepted.familyId}/members`, 300);
    const activeCount = members.filter((doc) => !readBoolean(doc.fields, "deleted")).length;
    const replacingPlaceholder = members.some(
      (doc) => doc.name.endsWith(`/${accepted.memberId}`) && accepted.memberId !== input.uid,
    );
    if (!replacingPlaceholder && activeCount >= MAX_FAMILY_MEMBERS) {
      await auditRedemptionFailure(accepted, input, "family_member_limit_reached");
      return { ok: false, reason: "family_member_limit_reached" };
    }
  }

  const theme = findColorThemeOptionById(DEFAULT_COLOR_THEME_OPTION_ID)?.theme ?? {
    primary: "#0072b2",
  };

  // The invited *name* is what the family knows this person by; the address
  // they happened to sign in with is only ever a contact detail, and is dropped
  // entirely when it is a private relay.
  await adminCreateOrReplaceDocument(memberPath, {
    name: stringField(accepted.invitedName || input.displayName || "Family member"),
    email: stringField(accepted.invitedEmail || familyVisibleEmail(input.email)),
    contactEmail: stringField(contactEmail(input.email)),
    uid: stringField(input.uid),
    role: stringField(accepted.role),
    locale: stringField(DEFAULT_LOCALE),
    status: stringField("active"),
    deleted: boolField(false),
    dashboardPrimaryColor: stringField(theme.primary),
    selectedConfettiOptionId: stringField(DEFAULT_CONFETTI_OPTION_ID),
    createdAt: timestampField(
      readTimestamp(existingMember?.fields, "createdAt") || accepted.createdAt || now,
    ),
    acceptedInviteAt: timestampField(now),
    acceptedInviteId: stringField(accepted.id),
    lastSignInAt: timestampField(now),
  });

  // Retire the placeholder invite doc this code was issued against, so the
  // family does not keep showing a ghost "invited" member next to the real one.
  // This only touches the document this invitation created.
  if (accepted.memberId && accepted.memberId !== input.uid) {
    await adminPatchDocument(
      `families/${accepted.familyId}/members/${accepted.memberId}`,
      {
        deleted: boolField(true),
        deletedAt: timestampField(now),
        replacedByUid: stringField(input.uid),
      },
      ["deleted", "deletedAt", "replacedByUid"],
    ).catch(() => undefined);
  }

  // Sign-in no longer writes `users/{uid}` for a family-less account, so this
  // may be creating the document rather than updating it. Admin credentials
  // bypass the Firestore rules, so nothing would reject a three-field write —
  // it would just leave a user document with no email, role, or locale. Write
  // the full shape when the document is absent.
  const userDocExists = (await tryGetDocument(`users/${input.uid}`)) !== null;
  await adminPatchDocument(
    `users/${input.uid}`,
    userDocExists
      ? {
          uid: stringField(input.uid),
          familyIds: stringArrayField([accepted.familyId]),
          lastFamilyUpdateAt: timestampField(now),
        }
      : buildIdpUserAuthFields({
          uid: input.uid,
          role: accepted.role,
          locale: input.locale || DEFAULT_LOCALE,
          email: contactEmail(input.email),
          displayName: input.displayName,
          photoUrl: input.photoUrl ?? "",
          provider: input.provider ?? "google",
          familyId: accepted.familyId,
          now,
        }),
    userDocExists
      ? ["uid", "familyIds", "lastFamilyUpdateAt"]
      : [
          "uid",
          "role",
          "locale",
          "email",
          "displayName",
          "photoUrl",
          "provider",
          "lastSignInAt",
          "familyIds",
          "lastFamilyUpdateAt",
        ],
  );

  await markFamilyInviteAccepted({
    inviteId: accepted.id,
    acceptedByUid: input.uid,
    acceptedByEmail: contactEmail(input.email),
    now,
  });

  await writeAdminAuditLogBestEffort({
    familyId: accepted.familyId,
    eventType: "family_invite_redeemed",
    actor: { uid: input.uid, email: contactEmail(input.email), name: input.displayName, role: "system" },
    userId: input.uid,
    source: "family_invite_code",
    reason: "invite_code",
    next: {
      inviteId: accepted.id,
      memberId: input.uid,
      role: accepted.role,
      replacedMemberId: accepted.memberId,
      alreadyMember,
    },
  });

  return {
    ok: true,
    familyId: accepted.familyId,
    familyName: accepted.familyName,
    role: accepted.role,
    memberId: input.uid,
    alreadyMember,
  };
}

async function auditRedemptionFailure(
  invite: FamilyInviteRecord,
  input: RedeemFamilyInviteInput,
  reason: RedeemFamilyInviteFailure,
) {
  await writeAdminAuditLogBestEffort({
    familyId: invite.familyId,
    eventType: "family_invite_redemption_failed",
    actor: { uid: input.uid, email: contactEmail(input.email), name: input.displayName, role: "system" },
    userId: input.uid,
    source: "family_invite_code",
    reason,
    next: { inviteId: invite.id, attemptCount: invite.attemptCount + 1 },
  });
}

async function readUserFamilyIds(uid: string) {
  const doc = await tryGetDocument(`users/${uid}`);
  return doc ? readStringArray(doc.fields, "familyIds").filter(Boolean) : [];
}

async function tryGetDocument(path: string) {
  try {
    return await adminGetDocument(path);
  } catch (error) {
    if (error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}
