import { NextRequest, NextResponse } from "next/server";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  buildIdpSessionUser,
  signInWithFirebaseIdp,
  upsertIdpUser,
} from "@/lib/auth/idp-signin";
import { mobileWebCorsPreflight, withMobileWebCors } from "@/lib/mobile-web-cors";

type GoogleTokenInfo = {
  aud: string;
  email?: string;
  name?: string;
  picture?: string;
  sub: string;
};

function getAllowedGoogleAudiences() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

async function verifyGoogleCredential(idToken: string) {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`GOOGLE_TOKENINFO_HTTP_${response.status}`);
  const tokenInfo = (await response.json()) as GoogleTokenInfo;
  const allowedAudiences = getAllowedGoogleAudiences();
  if (allowedAudiences.length === 0) throw new Error("GOOGLE_CLIENT_ID_MISSING");
  if (!allowedAudiences.includes(tokenInfo.aud)) throw new Error("GOOGLE_AUDIENCE_MISMATCH");
  return tokenInfo;
}

export function OPTIONS(request: NextRequest) {
  return mobileWebCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { idToken?: string };
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) {
    return withMobileWebCors(
      NextResponse.json({ ok: false, error: "missing_id_token" }, { status: 400 }),
      request,
    );
  }

  try {
    const tokenInfo = await verifyGoogleCredential(idToken);
    const firebaseSession = await signInWithFirebaseIdp({
      idToken,
      providerId: "google.com",
      requestUri: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    });
    const result = await upsertIdpUser({
      session: firebaseSession,
      identity: {
        subject: tokenInfo.sub,
        email: tokenInfo.email,
        name: tokenInfo.name,
        picture: tokenInfo.picture,
      },
      provider: "google",
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
        ...(result.familyResolution === "needs_family_setup"
          ? { familyResolution: result.familyResolution }
          : {}),
      },
    });
    setSessionUserCookie(response, buildIdpSessionUser(firebaseSession, result));
    return withMobileWebCors(response, request);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 120) : "unknown";
    console.error("[MOBILE_GOOGLE_AUTH_ERROR]", reason);
    return withMobileWebCors(
      NextResponse.json({ ok: false, error: "google_signin_failed" }, { status: 401 }),
      request,
    );
  }
}
