import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminRunQuery } from "@/lib/firestore/admin";
import { documentIdFromName, readInteger, readString, readTimestamp } from "@/lib/firestore/rest";
import {
  evaluateFamilyInviteRedeemability,
  FAMILY_INVITE_MAX_ATTEMPTS,
} from "@/lib/family/invite-tokens";
import { isPrivateRelayEmail } from "@/lib/auth/private-relay";

export const runtime = "nodejs";

/**
 * Operator view of invite-token state: which invites are live, which expired
 * unused, and which are locked out by failed attempts. The code itself is never
 * exposed — only its hash is stored, and support does not need it. Support
 * operators re-issue a code by asking the parent to re-invite.
 */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const docs = await adminRunQuery({
      from: [{ collectionId: "familyInvites" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: 500,
    });

    const invites = docs.map((doc) => {
      const status = readString(doc.fields, "status") || "pending";
      const expiresAt = readTimestamp(doc.fields, "expiresAt");
      const attemptCount = readInteger(doc.fields, "attemptCount");
      const redeemability = evaluateFamilyInviteRedeemability({
        status: status as "pending",
        expiresAt,
        attemptCount,
      });
      const invitedEmail = readString(doc.fields, "invitedEmail");
      return {
        id: documentIdFromName(doc.name),
        familyId: readString(doc.fields, "familyId"),
        familyName: readString(doc.fields, "familyName"),
        memberId: readString(doc.fields, "memberId"),
        invitedName: readString(doc.fields, "invitedName"),
        invitedEmail,
        // Surfaced so an operator can tell at a glance why an invite has no
        // family-visible address attached to it.
        privateRelayEmail: isPrivateRelayEmail(readString(doc.fields, "acceptedByEmail")),
        role: readString(doc.fields, "role"),
        status,
        redeemable: redeemability.ok,
        blockedReason: redeemability.ok ? "" : redeemability.reason,
        attemptCount,
        maxAttempts: FAMILY_INVITE_MAX_ATTEMPTS,
        createdAt: readTimestamp(doc.fields, "createdAt"),
        createdByUid: readString(doc.fields, "createdByUid"),
        expiresAt,
        acceptedAt: readTimestamp(doc.fields, "acceptedAt"),
        acceptedByUid: readString(doc.fields, "acceptedByUid"),
      };
    });

    return NextResponse.json({
      invites,
      summary: {
        total: invites.length,
        redeemable: invites.filter((invite) => invite.redeemable).length,
        accepted: invites.filter((invite) => invite.status === "accepted").length,
        expired: invites.filter((invite) => invite.blockedReason === "invite_expired").length,
        locked: invites.filter((invite) => invite.blockedReason === "invite_locked").length,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_INVITE_CODES_ERROR]", reason.slice(0, 200));
    return NextResponse.json({ error: "invite_codes_unavailable" }, { status: 500 });
  }
}
