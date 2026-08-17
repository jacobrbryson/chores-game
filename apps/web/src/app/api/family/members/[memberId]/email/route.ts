import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { keyableEmail } from "@/lib/auth/private-relay";
import {
  createFamilyInvite,
  listFamilyInvites,
  revokeFamilyInvite,
} from "@/lib/family/invite-repository";
import {
  buildFamilyInviteUrl,
  createFamilyInviteCode,
  createFamilyInviteId,
  formatFamilyInviteCode,
} from "@/lib/family/invite-tokens";
import {
  planMemberEmailChange,
  resolveMemberAccountState,
  type EmailChangeRejection,
} from "@/lib/family/member-email-change";
import {
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

const REJECTION_STATUS: Record<EmailChangeRejection, number> = {
  invalid_email: 400,
  email_unchanged: 400,
  email_already_in_use: 409,
  private_relay_email: 400,
  target_must_be_player: 403,
  cannot_change_own_email: 403,
  member_not_found: 404,
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

async function readProviderForUid(uid: string, idToken: string) {
  if (!uid.trim()) {
    return "";
  }
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    return readString(userDoc.fields, "provider").trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return "";
    }
    throw error;
  }
}

/**
 * Change a player's email address.
 *
 * See lib/family/member-email-change.ts for the security reasoning. In short:
 * this never moves a sign-in identity. A member who has never accepted an invite
 * gets the address parked in `pendingEmail` behind a fresh single-use invite
 * code (and their old invite lookup revoked immediately); anyone who already has
 * an account gets a contact-detail update and keeps signing in exactly as before.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const requestedEmail = typeof body.email === "string" ? body.email : "";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        // Role is always checked server-side against the family document, never
        // trusted from the session cookie.
        const requesterDoc = await getDocument(
          `families/${familyId}/members/${session.memberId || session.uid}`,
          idToken,
        ).catch(async () => getDocument(`families/${familyId}/members/${session.uid}`, idToken));
        if (readString(requesterDoc.fields, "role") !== "admin") {
          return { kind: "not_allowed" as const };
        }

        const members = await listDocuments(`families/${familyId}/members`, idToken, 300);
        const targetDocRef = members.find((doc) => documentIdFromName(doc.name) === memberId);
        if (!targetDocRef) {
          return { kind: "rejected" as const, reason: "member_not_found" as EmailChangeRejection };
        }

        const targetUid = readString(targetDocRef.fields, "uid").trim();
        const currentEmail = readString(targetDocRef.fields, "email").trim().toLowerCase();
        const targetName = readString(targetDocRef.fields, "name");
        const accountState = resolveMemberAccountState({
          memberUid: targetUid,
          provider: await readProviderForUid(targetUid, idToken),
        });

        const decision = planMemberEmailChange({
          requestedEmail,
          currentEmail,
          targetRole: readString(targetDocRef.fields, "role"),
          targetDeleted: readBoolean(targetDocRef.fields, "deleted"),
          targetIsSelf: memberId === session.uid || (targetUid !== "" && targetUid === session.uid),
          accountState,
          otherActiveEmails: members
            .filter(
              (doc) =>
                documentIdFromName(doc.name) !== memberId && !readBoolean(doc.fields, "deleted"),
            )
            .map((doc) => readString(doc.fields, "email")),
        });
        if (!decision.ok) {
          return { kind: "rejected" as const, reason: decision.reason };
        }

        const { plan } = decision;
        const now = new Date().toISOString();
        const auditActor = {
          uid: session.uid,
          email: session.email,
          name: session.name,
          role: "admin" as const,
        };

        if (plan.mode === "contact_only") {
          await patchDocument(
            `families/${familyId}/members/${memberId}`,
            { email: stringField(plan.nextEmail), updatedAt: timestampField(now) },
            idToken,
            ["email", "updatedAt"],
          );
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "member_email_changed",
            actor: auditActor,
            userId: targetUid || memberId,
            source: "family_member_email",
            reason: "parent_changed_member_contact_email",
            previous: { email: currentEmail },
            next: {
              email: plan.nextEmail,
              mode: plan.mode,
              accountState: plan.accountState,
              signInUnchanged: true,
            },
          });
          return {
            kind: "ok" as const,
            mode: plan.mode,
            accountState: plan.accountState,
            canInviteToSignIn: plan.canInviteToSignIn,
            email: plan.nextEmail,
            pendingEmail: "",
            invite: null,
          };
        }

        // verification_required: the address is only a *claim* until a fresh
        // single-use code is redeemed, so `email` is left untouched.
        //
        // Revoke first. Any code already issued for this member went to the OLD
        // address, and it stays redeemable unless it is explicitly killed —
        // re-pointing the address while leaving the previous code live would let
        // the old recipient claim the seat after the parent thought they had
        // moved it. This is the actual revocation; the inviteLookup write below
        // is legacy bookkeeping.
        const revokedInviteIds: string[] = [];
        for (const existing of await listFamilyInvites(familyId)) {
          if (existing.status !== "pending" || existing.memberId !== memberId) {
            continue;
          }
          await revokeFamilyInvite(existing.id);
          revokedInviteIds.push(existing.id);
        }

        const inviteId = createFamilyInviteId();
        const code = createFamilyInviteCode();
        let familyName = "";
        try {
          familyName = readString((await getDocument(`families/${familyId}`, idToken)).fields, "name");
        } catch {
          // Presentation metadata only; the invite does not depend on it.
        }
        const createdInvite = await createFamilyInvite({
          inviteId,
          code,
          familyId,
          familyName,
          memberId,
          invitedName: targetName,
          invitedEmail: plan.nextEmail,
          role: "player",
          createdByUid: session.uid,
          now,
        });

        await patchDocument(
          `families/${familyId}/members/${memberId}`,
          {
            pendingEmail: stringField(plan.nextEmail),
            pendingEmailRequestedAt: timestampField(now),
            pendingEmailInviteId: stringField(inviteId),
            updatedAt: timestampField(now),
          },
          idToken,
          ["pendingEmail", "pendingEmailRequestedAt", "pendingEmailInviteId", "updatedAt"],
        );

        // Revoke the previous address' lookup first: a mistyped or stale address
        // must stop being able to join immediately, not once the new one is used.
        const previousKeyEmail = keyableEmail(currentEmail);
        if (previousKeyEmail && previousKeyEmail !== plan.nextEmail) {
          await createOrReplaceDocument(
            `inviteLookup/${previousKeyEmail}`,
            {
              email: stringField(previousKeyEmail),
              familyId: stringField(familyId),
              status: stringField("revoked"),
              updatedAt: timestampField(now),
            },
            idToken,
          );
        }
        await createOrReplaceDocument(
          `inviteLookup/${plan.nextEmail}`,
          {
            email: stringField(plan.nextEmail),
            familyId: stringField(familyId),
            role: stringField("player"),
            status: stringField("invited"),
            updatedAt: timestampField(now),
          },
          idToken,
        );

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "member_email_change_requested",
          actor: auditActor,
          userId: targetUid || memberId,
          source: "family_member_email",
          reason: "parent_requested_member_email_change",
          previous: { email: currentEmail },
          next: {
            pendingEmail: plan.nextEmail,
            mode: plan.mode,
            accountState: plan.accountState,
            inviteId,
            expiresAt: createdInvite.expiresAt,
            revokedInviteLookup: previousKeyEmail,
            revokedInviteIds: revokedInviteIds.join(","),
          },
        });

        return {
          kind: "ok" as const,
          mode: plan.mode,
          accountState: plan.accountState,
          canInviteToSignIn: plan.canInviteToSignIn,
          email: currentEmail,
          pendingEmail: plan.nextEmail,
          invite: {
            code,
            formattedCode: formatFamilyInviteCode(code),
            url: buildFamilyInviteUrl(code),
            expiresAt: createdInvite.expiresAt,
          },
        };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "not_allowed") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }
    if (data.kind === "rejected") {
      return NextResponse.json({ error: data.reason }, { status: REJECTION_STATUS[data.reason] });
    }

    const response = NextResponse.json({
      success: true,
      mode: data.mode,
      accountState: data.accountState,
      canInviteToSignIn: data.canInviteToSignIn,
      email: data.email,
      pendingEmail: data.pendingEmail,
      invite: data.invite,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[UPDATE_FAMILY_MEMBER_EMAIL_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "firestore_forbidden" }, { status: 403 });
    }
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "member_email_update_failed" }, { status: 500 });
  }
}
