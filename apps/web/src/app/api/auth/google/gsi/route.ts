import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedSessionIdentity,
  isSessionSwitched,
  switchSessionIdentity,
  type SessionUser,
} from "@/lib/auth/session";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { createFamilyForUser } from "@/lib/family/bootstrap";
import {
  boolField,
  findFirstFamilyIdByMemberEmail,
  getDocument,
  listDocuments,
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

type FirebaseSession = {
  displayName?: string;
  email?: string;
  idToken: string;
  refreshToken?: string;
  localId: string;
  photoUrl?: string;
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

async function resolveActiveFamilyMembership(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<{ memberId: string; role: SessionUser["role"] } | null> {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return null;
    }
    if (readString(memberDoc.fields, "status") !== "active") {
      return null;
    }
    return {
      memberId: uid,
      role: readString(memberDoc.fields, "role") === "admin" ? "admin" : "player",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    if (readString(doc.fields, "status") !== "active") {
      return false;
    }
    return readString(doc.fields, "uid") === uid;
  });
  if (!matchedMember) {
    return null;
  }
  return {
    memberId: matchedMember.name.split("/").pop() ?? uid,
    role: readString(matchedMember.fields, "role") === "admin" ? "admin" : "player",
  };
}

async function upsertFirebaseUser(
  session: FirebaseSession,
  tokenInfo: GoogleTokenInfo,
) {
  const now = new Date().toISOString();
  const normalizedEmail = (tokenInfo.email ?? session.email ?? "").trim().toLowerCase();
  let existingFamilyIds: string[] = [];
  let existingUserRole: SessionUser["role"] = "player";
  let hasExistingUserDoc = false;
  try {
    const existingUserDoc = await getDocument(`users/${session.localId}`, session.idToken);
    hasExistingUserDoc = true;
    existingFamilyIds = readStringArray(existingUserDoc.fields, "familyIds");
    existingUserRole = readString(existingUserDoc.fields, "role") === "admin" ? "admin" : "player";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  let linkedFamilyId = existingFamilyIds[0] ?? "";
  if (!linkedFamilyId && normalizedEmail) {
    try {
      const inviteLookupDoc = await getDocument(`inviteLookup/${normalizedEmail}`, session.idToken);
      const inviteLookupStatus = readString(inviteLookupDoc.fields, "status");
      const inviteLookupFamilyId = readString(inviteLookupDoc.fields, "familyId");
      if (inviteLookupStatus === "invited" && inviteLookupFamilyId) {
        linkedFamilyId = inviteLookupFamilyId;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }
  if (!linkedFamilyId && normalizedEmail) {
    linkedFamilyId = await findFirstFamilyIdByMemberEmail(normalizedEmail, session.idToken);
  }
  const shouldBootstrapFamily = !hasExistingUserDoc && !linkedFamilyId;
  if (shouldBootstrapFamily) {
    linkedFamilyId = await createFamilyForUser({
      uid: session.localId,
      userName: tokenInfo.name ?? session.displayName ?? "",
      userEmail: normalizedEmail,
      idToken: session.idToken,
    });
  }
  const linkedFamilyMembership = linkedFamilyId
    ? await resolveActiveFamilyMembership(linkedFamilyId, session.localId, session.idToken)
    : null;
  const effectiveRole: SessionUser["role"] = shouldBootstrapFamily
    ? "admin"
    : linkedFamilyMembership?.role ?? (existingUserRole === "admin" ? "admin" : "player");

  const authFields = {
    uid: stringField(session.localId),
    role: stringField(effectiveRole),
    email: stringField(normalizedEmail),
    displayName: stringField(tokenInfo.name ?? session.displayName ?? ""),
    photoUrl: stringField(tokenInfo.picture ?? session.photoUrl ?? ""),
    provider: stringField("google"),
    lastSignInAt: timestampField(now),
    ...(linkedFamilyId
      ? {
          familyIds: stringArrayField([linkedFamilyId]),
          lastFamilyUpdateAt: timestampField(now),
        }
      : {}),
  };
  await patchDocument(
    `users/${session.localId}`,
    authFields,
    session.idToken,
    Object.keys(authFields),
  );

  if (linkedFamilyId) {
    try {
      await patchDocument(
        `families/${linkedFamilyId}/members/${session.localId}`,
        {
          lastSignInAt: timestampField(now),
        },
        session.idToken,
        ["lastSignInAt"],
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404") && !reason.includes("FIRESTORE_HTTP_403")) {
        throw error;
      }
    }
  }

  return {
    role: effectiveRole,
    memberId: linkedFamilyMembership?.memberId ?? session.localId,
  };
}

async function linkManagedChildToGoogleAccount(input: {
  requestSession: SessionUser;
  firebaseSession: FirebaseSession;
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

  await patchDocument(
    `users/${input.firebaseSession.localId}`,
    {
      uid: stringField(input.firebaseSession.localId),
      role: stringField("player"),
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
      status: stringField("active"),
      lastSignInAt: timestampField(now),
      updatedAt: timestampField(now),
    },
    adminIdToken,
    ["uid", "email", "name", "status", "lastSignInAt", "updatedAt"],
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
    const firebaseSession = await signInWithFirebase(
      credential,
      publicOrigin,
    );
    const normalizedEmail = (tokenInfo.email ?? firebaseSession.email ?? "").trim().toLowerCase();
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
    let resolvedRole: SessionUser["role"] = "player";
    let resolvedMemberId = firebaseSession.localId;
    if (firebaseSession) {
      const result = await upsertFirebaseUser(firebaseSession, tokenInfo);
      resolvedRole = result.role;
      resolvedMemberId = result.memberId;
    }

    const redirect = redirectToPath(request, "/");
    const sessionCookie: SessionUser = {
      uid: firebaseSession.localId,
      memberId: resolvedMemberId,
      role: resolvedRole,
      email: normalizedEmail,
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
    if (intent === "link_account") {
      return redirectToPath(request, "/profile", { googleAccountError: "link_failed" });
    }
    return redirectToPath(request, "/", { error: "google_signin_failed" });
  }
}

