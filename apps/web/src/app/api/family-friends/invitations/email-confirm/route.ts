import { NextRequest, NextResponse } from "next/server";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { getFamilyFriendInvite } from "@/lib/family-friends/repository";
import { hashFamilyFriendToken, isFamilyFriendInviteExpired } from "@/lib/family-friends/model";

// Redirect targets are built from the canonical app origin, never from
// `request.url`. Behind Cloud Run the incoming request URL resolves to the
// container's internal bind address (https://0.0.0.0:8080), which sent everyone
// who clicked the invite email CTA to a host that does not resolve.
function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getCanonicalAppOrigin()));
}

export async function GET(request: NextRequest) {
  const inviteId = request.nextUrl.searchParams.get("invite")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!inviteId || !token) {
    return redirectTo("/?friendInvite=invalid");
  }
  try {
    const invite = await getFamilyFriendInvite(inviteId);
    if (
      !invite ||
      invite.status !== "pending" ||
      isFamilyFriendInviteExpired(invite.expiresAt) ||
      hashFamilyFriendToken(token) !== invite.tokenHash
    ) {
      return redirectTo("/?friendInvite=invalid");
    }
    const response = redirectTo(`/?friendInvite=${encodeURIComponent(inviteId)}`);
    response.cookies.set("pending_family_friend_invite", inviteId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch {
    return redirectTo("/?friendInvite=invalid");
  }
}
