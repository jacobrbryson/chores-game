import { NextRequest, NextResponse } from "next/server";
import { seedDiscoveryStateForNewUser } from "@/lib/discovery/service";
import { verifyAppleIdentityToken } from "@/lib/auth/apple-token";
import { formatAppleDisplayName } from "@/lib/auth/apple-name";
import {
  buildIdpSessionUser,
  signInWithFirebaseIdp,
  upsertIdpUser,
} from "@/lib/auth/idp-signin";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getCanonicalAppOrigin } from "@/lib/app-origin";

type AppleAuthBody = {
  idToken?: unknown;
  rawNonce?: unknown;
  user?: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as AppleAuthBody;
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  const rawNonce = typeof body.rawNonce === "string" ? body.rawNonce.trim() : "";
  if (!idToken || !rawNonce) {
    return NextResponse.json({ ok: false, error: "missing_apple_credential" }, { status: 400 });
  }

  try {
    const verified = await verifyAppleIdentityToken({ idToken, rawNonce });
    const firebaseSession = await signInWithFirebaseIdp({
      idToken,
      rawNonce,
      providerId: "apple.com",
      requestUri: getCanonicalAppOrigin(),
      includeErrorDetail: true,
    });
    const result = await upsertIdpUser({
      session: firebaseSession,
      identity: {
        subject: verified.subject,
        email: verified.email,
        name: formatAppleDisplayName(body.user),
      },
      provider: "apple",
      touchMemberLastSignIn: true,
    });
    // Deferred user document means there is no account to seed against yet;
    // the next sign-in after family setup still reports isNewUser and seeds then.
    if (result.isNewUser && !result.userDocDeferred) {
      try {
        await seedDiscoveryStateForNewUser(firebaseSession.localId, result.memberId, firebaseSession.idToken);
      } catch (error) {
        console.error("[DISCOVERY_SEED_ERROR]", error instanceof Error ? error.message : error);
      }
    }
    const response = NextResponse.json({
      ok: true,
      data: {
        redirect: result.familyResolution === "needs_family_setup"
          ? "/?auth_state=needs_family_setup"
          : "/",
        familyResolution: result.familyResolution,
      },
    });
    setSessionUserCookie(response, buildIdpSessionUser(firebaseSession, result));
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 120) : "unknown";
    console.error("[APPLE_AUTH_ERROR]", reason);
    return NextResponse.json({ ok: false, error: "apple_signin_failed" }, { status: 401 });
  }
}
