import { NextRequest, NextResponse } from "next/server";
import { verifyAppleIdentityToken } from "@/lib/auth/apple-token";
import { formatAppleDisplayName } from "@/lib/auth/apple-name";
import {
  buildIdpSessionUser,
  signInWithFirebaseIdp,
  upsertIdpUser,
} from "@/lib/auth/idp-signin";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { mobileWebCorsPreflight, withMobileWebCors } from "@/lib/mobile-web-cors";

export function OPTIONS(request: NextRequest) {
  return mobileWebCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    idToken?: unknown;
    rawNonce?: unknown;
    user?: unknown;
  };
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  const rawNonce = typeof body.rawNonce === "string" ? body.rawNonce.trim() : "";
  if (!idToken || !rawNonce) {
    return withMobileWebCors(
      NextResponse.json({ ok: false, error: "missing_apple_credential" }, { status: 400 }),
      request,
    );
  }

  try {
    const verified = await verifyAppleIdentityToken({ idToken, rawNonce });
    const firebaseSession = await signInWithFirebaseIdp({
      idToken,
      rawNonce,
      providerId: "apple.com",
      requestUri: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    });
    const result = await upsertIdpUser({
      session: firebaseSession,
      identity: {
        subject: verified.subject,
        email: verified.email,
        name: formatAppleDisplayName(body.user),
      },
      provider: "apple",
    });
    const response = NextResponse.json({
      ok: true,
      data: {
        uid: firebaseSession.localId,
        role: result.role,
        locale: result.locale,
        email: result.normalizedEmail,
        name: result.displayName,
        picture: result.photoUrl,
        familyResolution: result.familyResolution,
      },
    });
    setSessionUserCookie(response, buildIdpSessionUser(firebaseSession, result));
    return withMobileWebCors(response, request);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 120) : "unknown";
    console.error("[MOBILE_APPLE_AUTH_ERROR]", reason);
    return withMobileWebCors(
      NextResponse.json({ ok: false, error: "apple_signin_failed" }, { status: 401 }),
      request,
    );
  }
}
