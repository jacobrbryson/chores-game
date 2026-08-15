import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, resolveLocalePreference } from "@packages/locales";
import {
  getAuthenticatedSessionIdentity,
  isSessionSwitched,
  switchSessionIdentity,
  type SessionUser,
} from "@/lib/auth/session";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  buildIdpSessionUser,
  signInWithFirebaseIdp,
  upsertIdpUser,
  type FirebaseIdpSession,
} from "@/lib/auth/idp-signin";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { seedDiscoveryStateForNewUser } from "@/lib/discovery/service";
import {
  boolField,
  getDocument,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type GoogleTokenInfo = {
  aud: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  sub: string;
};

function redirectToPath(
  request: NextRequest,
  path: string,
  params: Record<string, string> = {},
) {
  const url = new URL(path, getCanonicalAppOrigin());
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

async function linkManagedChildToGoogleAccount(input: {
  requestSession: SessionUser;
  firebaseSession: FirebaseIdpSession;
  tokenInfo: GoogleTokenInfo;
}) {
  const now = new Date().toISOString();
  const currentSession = input.requestSession;
  const authenticated = getAuthenticatedSessionIdentity(currentSession);
  if (!isSessionSwitched(currentSession) || authenticated.role !== "admin" || currentSession.role !== "player") {
    throw new Error("GOOGLE_LINK_FORBIDDEN");
  }

  const localUid = currentSession.uid;
  const memberId = currentSession.memberId || currentSession.uid;
  const adminIdToken = currentSession.firebaseIdToken;
  if (!adminIdToken) {
    throw new Error("MISSING_FIREBASE_ID_TOKEN");
  }
  const normalizedEmail = (input.tokenInfo.email ?? input.firebaseSession.email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("GOOGLE_LINK_EMAIL_REQUIRED");
  }

  const localUserDoc = await getDocument(`users/${localUid}`, adminIdToken);
  const familyId = readStringArray(localUserDoc.fields, "familyIds")[0] ?? "";
  if (!familyId) {
    throw new Error("GOOGLE_LINK_FAMILY_NOT_FOUND");
  }
  const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, adminIdToken);
  if (readBoolean(memberDoc.fields, "deleted")) {
    throw new Error("GOOGLE_LINK_MEMBER_NOT_FOUND");
  }
  if (readString(memberDoc.fields, "role") !== "player") {
    throw new Error("GOOGLE_LINK_PLAYER_ONLY");
  }

  const effectiveLocale = resolveLocalePreference({
    requestedLocale:
      readString(localUserDoc.fields, "locale").trim() ||
      readString(memberDoc.fields, "locale").trim(),
    familyLocale: familyId ? readString((await getDocument(`families/${familyId}`, adminIdToken)).fields, "defaultLocale").trim() : "",
    fallbackLocale: DEFAULT_LOCALE,
  });

  await patchDocument(
    `users/${input.firebaseSession.localId}`,
    {
      uid: stringField(input.firebaseSession.localId),
      role: stringField("player"),
      locale: stringField(effectiveLocale),
      provider: stringField("google"),
      email: stringField(normalizedEmail),
      displayName: stringField(input.tokenInfo.name ?? input.firebaseSession.displayName ?? currentSession.name),
      photoUrl: stringField(input.tokenInfo.picture ?? input.firebaseSession.photoUrl ?? ""),
      familyIds: stringArrayField([familyId]),
      walletBalance: { integerValue: String(readInteger(localUserDoc.fields, "walletBalance")) },
      ownedStoreOptionIds: stringArrayField(readStringArray(localUserDoc.fields, "ownedStoreOptionIds")),
      preferencesThemeOptionId: stringField(readString(localUserDoc.fields, "preferencesThemeOptionId")),
      preferencesThemePrimaryColor: stringField(readString(localUserDoc.fields, "preferencesThemePrimaryColor")),
      preferencesThemeSecondaryColor: stringField(readString(localUserDoc.fields, "preferencesThemeSecondaryColor")),
      preferencesThemeTertiaryColor: stringField(readString(localUserDoc.fields, "preferencesThemeTertiaryColor")),
      preferencesMyChoresOnly: boolField(readBoolean(localUserDoc.fields, "preferencesMyChoresOnly")),
      preferencesCompletionWindow: stringField(readString(localUserDoc.fields, "preferencesCompletionWindow")),
      selectedConfettiOptionId: stringField(readString(localUserDoc.fields, "selectedConfettiOptionId")),
      storeUpdatedAt: timestampField(now),
      preferencesUpdatedAt: timestampField(now),
      lastFamilyUpdateAt: timestampField(now),
      lastSignInAt: timestampField(now),
    },
    input.firebaseSession.idToken,
    [
      "uid",
      "role",
      "locale",
      "provider",
      "email",
      "displayName",
      "photoUrl",
      "familyIds",
      "walletBalance",
      "ownedStoreOptionIds",
      "preferencesThemeOptionId",
      "preferencesThemePrimaryColor",
      "preferencesThemeSecondaryColor",
      "preferencesThemeTertiaryColor",
      "preferencesMyChoresOnly",
      "preferencesCompletionWindow",
      "selectedConfettiOptionId",
      "storeUpdatedAt",
      "preferencesUpdatedAt",
      "lastFamilyUpdateAt",
      "lastSignInAt",
    ],
  );

  await patchDocument(
    `families/${familyId}/members/${memberId}`,
    {
      uid: stringField(input.firebaseSession.localId),
      email: stringField(normalizedEmail),
      name: stringField(input.tokenInfo.name ?? readString(memberDoc.fields, "name") ?? currentSession.name),
      locale: stringField(effectiveLocale),
      status: stringField("active"),
      lastSignInAt: timestampField(now),
      updatedAt: timestampField(now),
    },
    adminIdToken,
    ["uid", "email", "name", "locale", "status", "lastSignInAt", "updatedAt"],
  );

  await patchDocument(
    `users/${localUid}`,
    {
      linkedGoogleUid: stringField(input.firebaseSession.localId),
      linkedGoogleEmail: stringField(normalizedEmail),
      linkedGoogleAt: timestampField(now),
    },
    adminIdToken,
    ["linkedGoogleUid", "linkedGoogleEmail", "linkedGoogleAt"],
  );

  return switchSessionIdentity(currentSession, {
    uid: input.firebaseSession.localId,
    memberId,
    role: "player",
    email: normalizedEmail,
    name: input.tokenInfo.name ?? currentSession.name,
    picture: input.tokenInfo.picture ?? currentSession.picture,
    locale: effectiveLocale,
  });
}

export async function POST(request: NextRequest) {
  const currentSession = getSessionFromRequest(request);
  const formData = await request.formData();
  const credential = formData.get("credential");
  const csrfBody = formData.get("g_csrf_token");
  const csrfCookie = request.cookies.get("g_csrf_token")?.value;
  const intent = request.nextUrl.searchParams.get("intent")?.trim() ?? "";

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
    const publicOrigin = getCanonicalAppOrigin();
    const firebaseSession = await signInWithFirebaseIdp({
      idToken: credential,
      providerId: "google.com",
      requestUri: publicOrigin,
      includeErrorDetail: true,
    });
    if (intent === "link_account") {
      if (!currentSession) {
        return redirectToPath(request, "/profile", { googleAccountError: "unauthorized" });
      }
      const nextSession = await linkManagedChildToGoogleAccount({
        requestSession: currentSession,
        firebaseSession,
        tokenInfo,
      });
      const redirect = redirectToPath(request, "/profile", { googleAccount: "linked" });
      setSessionUserCookie(redirect, nextSession);
      return redirect;
    }
    const result = await upsertIdpUser({
      session: firebaseSession,
      identity: {
        subject: tokenInfo.sub,
        email: tokenInfo.email,
        name: tokenInfo.name,
        picture: tokenInfo.picture,
      },
      provider: "google",
      touchMemberLastSignIn: true,
    });
    if (result.isNewUser) {
      try {
        await seedDiscoveryStateForNewUser(
          firebaseSession.localId,
          result.memberId,
          firebaseSession.idToken,
        );
      } catch (error) {
        console.error("[DISCOVERY_SEED_ERROR]", error instanceof Error ? error.message : error);
      }
    }

    const redirect = redirectToPath(
      request,
      "/",
      result.familyResolution === "needs_family_setup" ? { auth_state: "needs_family_setup" } : {},
    );
    const sessionCookie = buildIdpSessionUser(firebaseSession, result);
    setSessionUserCookie(redirect, sessionCookie);
    return redirect;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message.slice(0, 120)
        : "unknown";
    console.error("[GSI_AUTH_ERROR]", reason);
    if (intent === "link_account") {
      return redirectToPath(request, "/profile", { googleAccountError: "link_failed" });
    }
    return redirectToPath(request, "/", { error: "google_signin_failed" });
  }
}
