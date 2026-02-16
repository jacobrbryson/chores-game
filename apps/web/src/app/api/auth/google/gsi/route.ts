import { NextRequest, NextResponse } from "next/server";
import {
  type SessionUser,
} from "@/lib/auth/session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { patchDocument, stringField, timestampField } from "@/lib/firestore/rest";

type GoogleTokenInfo = {
  aud: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  sub: string;
};

type FirebaseSession = {
  displayName?: string;
  email?: string;
  idToken: string;
  refreshToken?: string;
  localId: string;
  photoUrl?: string;
};

function resolvePublicOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto && host) {
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}

function redirectToPath(
  request: NextRequest,
  path: string,
  params: Record<string, string> = {},
) {
  const url = new URL(path, resolvePublicOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

async function verifyGoogleCredential(idToken: string) {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GOOGLE_TOKENINFO_HTTP_${response.status}`);
  }

  const tokenInfo = (await response.json()) as GoogleTokenInfo;
  const expectedClientId = process.env.GOOGLE_CLIENT_ID;
  if (!expectedClientId) {
    throw new Error("GOOGLE_CLIENT_ID_MISSING");
  }

  if (tokenInfo.aud !== expectedClientId) {
    throw new Error("GOOGLE_AUDIENCE_MISMATCH");
  }

  return tokenInfo;
}

async function signInWithFirebase(googleIdToken: string, requestUri: string) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY_MISSING");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        requestUri,
        returnSecureToken: true,
        returnIdpCredential: false,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as {
        error?: { message?: string };
      };
      detail = json.error?.message ?? "";
    } catch {
      detail = "";
    }
    throw new Error(
      `FIREBASE_AUTH_FAILED_${response.status}${detail ? `_${detail}` : ""}`,
    );
  }

  return (await response.json()) as FirebaseSession;
}

async function upsertFirebaseUser(
  session: FirebaseSession,
  tokenInfo: GoogleTokenInfo,
) {
  const now = new Date().toISOString();
  const authFields = {
    uid: stringField(session.localId),
    role: stringField("player"),
    email: stringField(tokenInfo.email ?? session.email ?? ""),
    displayName: stringField(tokenInfo.name ?? session.displayName ?? ""),
    photoUrl: stringField(tokenInfo.picture ?? session.photoUrl ?? ""),
    provider: stringField("google"),
    lastSignInAt: timestampField(now),
  };
  await patchDocument(
    `users/${session.localId}`,
    authFields,
    session.idToken,
    Object.keys(authFields),
  );
  return true;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const credential = formData.get("credential");
  const csrfBody = formData.get("g_csrf_token");
  const csrfCookie = request.cookies.get("g_csrf_token")?.value;

  if (
    typeof csrfBody !== "string" ||
    typeof csrfCookie !== "string" ||
    csrfBody.length === 0 ||
    csrfCookie.length === 0 ||
    csrfBody !== csrfCookie
  ) {
    return redirectToPath(request, "/", { error: "csrf_mismatch" });
  }

  if (typeof credential !== "string" || credential.length === 0) {
    return redirectToPath(request, "/", { error: "missing_credential" });
  }

  try {
    const tokenInfo = await verifyGoogleCredential(credential);
    const publicOrigin = resolvePublicOrigin(request);
    const firebaseSession = await signInWithFirebase(
      credential,
      publicOrigin,
    );
    if (firebaseSession) {
      await upsertFirebaseUser(firebaseSession, tokenInfo);
    }

    const redirect = redirectToPath(request, "/");
    const sessionCookie: SessionUser = {
      uid: firebaseSession.localId,
      role: "player",
      email: tokenInfo.email ?? firebaseSession.email ?? "",
      name: tokenInfo.name ?? firebaseSession.displayName ?? "",
      picture: tokenInfo.picture ?? firebaseSession.photoUrl ?? "",
      firebaseIdToken: firebaseSession.idToken,
      firebaseRefreshToken: firebaseSession.refreshToken,
    };
    setSessionUserCookie(redirect, sessionCookie);
    return redirect;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message.slice(0, 120)
        : "unknown";
    console.error("[GSI_AUTH_ERROR]", reason);
    return redirectToPath(request, "/", { error: "google_signin_failed" });
  }
}
