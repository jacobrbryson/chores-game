import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { redeemFamilyInvite } from "@/lib/family/invite-redemption";
import { normalizeFamilyInviteCode } from "@/lib/family/invite-tokens";

type RedeemBody = { code?: string };

/**
 * Redeems a family invite code (typed by hand, or carried by an invite link).
 *
 * This is the join path for anyone whose sign-in address does not match the
 * address they were invited at — Apple Hide My Email relays, or a second Google
 * account. No email comparison happens anywhere in it.
 */
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RedeemBody;
  try {
    body = (await request.json()) as RedeemBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = normalizeFamilyInviteCode(body.code);
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  try {
    const result = await redeemFamilyInvite({
      code,
      uid: session.uid,
      email: session.email ?? "",
      displayName: session.name ?? "",
      locale: session.locale,
      photoUrl: session.picture ?? "",
      provider: session.provider,
    });

    if (!result.ok) {
      const status = result.reason === "family_member_limit_reached" ? 409 : 400;
      return NextResponse.json({ error: result.reason }, { status });
    }

    const response = NextResponse.json({
      success: true,
      familyId: result.familyId,
      familyName: result.familyName,
      role: result.role,
      alreadyMember: result.alreadyMember,
    });
    // The caller's role and member identity just changed, so reissue the
    // session cookie rather than leaving them on a pre-join session.
    setSessionUserCookie(response, {
      ...session,
      memberId: result.memberId,
      role: result.role,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[REDEEM_FAMILY_INVITE_ERROR]", reason);
    return NextResponse.json({ error: "redeem_invite_failed" }, { status: 500 });
  }
}
