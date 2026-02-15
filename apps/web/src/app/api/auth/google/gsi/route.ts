import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE_MAX_AGE,
  type SessionUser,
} from "@/lib/auth/session";

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
  localId: string;
  photoUrl?: string;
};

function redirectToPath(
  request: NextRequest,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(path, request.url);
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
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    return false;
  }

  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${session.localId}`;
  const now = new Date().toISOString();

  const response = await fetch(docUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.idToken}`,
    },
    body: JSON.stringify({
      fields: {
        uid: { stringValue: session.localId },
        role: { stringValue: "player" },
        email: { stringValue: tokenInfo.email ?? session.email ?? "" },
        displayName: {
          stringValue: tokenInfo.name ?? session.displayName ?? "",
        },
        photoUrl: { stringValue: tokenInfo.picture ?? session.photoUrl ?? "" },
        provider: { stringValue: "google" },
        lastSignInAt: { timestampValue: now },
      },
    }),
    cache: "no-store",
  });

  return response.ok;
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
    const firebaseSession = await signInWithFirebase(
      credential,
      request.nextUrl.origin,
    );
    let persisted = "0";

    if (firebaseSession) {
      const written = await upsertFirebaseUser(firebaseSession, tokenInfo);
      persisted = written ? "1" : "0";
    }

    const redirect = redirectToPath(request, "/", { success: "1", persisted });
    const sessionCookie: SessionUser = {
      uid: firebaseSession.localId,
      role: "player",
      email: tokenInfo.email ?? firebaseSession.email ?? "",
      name: tokenInfo.name ?? firebaseSession.displayName ?? "",
      picture: tokenInfo.picture ?? firebaseSession.photoUrl ?? "",
    };
    const sessionValue = createSessionToken(sessionCookie);
    if (!sessionValue) {
      return redirectToPath(request, "/", { error: "session_config" });
    }

    redirect.cookies.set("session_user", sessionValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
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
