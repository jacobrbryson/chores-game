import { NextRequest, NextResponse } from "next/server";
import { getFamilyFriendInvite } from "@/lib/family-friends/repository";
import { hashFamilyFriendToken, isFamilyFriendInviteExpired } from "@/lib/family-friends/model";

export async function GET(request: NextRequest) {
  const inviteId = request.nextUrl.searchParams.get("invite")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!inviteId || !token) {
    return NextResponse.redirect(new URL("/?friendInvite=invalid", request.url));
  }
  try {
    const invite = await getFamilyFriendInvite(inviteId);
    if (
      !invite ||
      invite.status !== "pending" ||
      isFamilyFriendInviteExpired(invite.expiresAt) ||
      hashFamilyFriendToken(token) !== invite.tokenHash
    ) {
      return NextResponse.redirect(new URL("/?friendInvite=invalid", request.url));
    }
    const response = NextResponse.redirect(new URL(`/?friendInvite=${encodeURIComponent(inviteId)}`, request.url));
    response.cookies.set("pending_family_friend_invite", inviteId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?friendInvite=invalid", request.url));
  }
}
