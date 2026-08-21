import { DEFAULT_LOCALE, resolveLocalePreference } from "@packages/locales";
import type { SessionUser } from "@/lib/auth/session";
import { buildIdpUserAuthFields, type AuthProvider } from "@/lib/auth/idp-user-fields";
import {
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  timestampField,
} from "@/lib/firestore/rest";

export type VerifiedIdpIdentity = {
  email?: string;
  name?: string;
  picture?: string;
  subject: string;
};

export type FirebaseIdpSession = {
  displayName?: string;
  email?: string;
  idToken: string;
  refreshToken?: string;
  localId: string;
  photoUrl?: string;
};

export type FamilyResolution = "resolved" | "needs_family_setup";

export async function signInWithFirebaseIdp(input: {
  idToken: string;
  providerId: `${AuthProvider}.com`;
  requestUri: string;
  rawNonce?: string;
  includeErrorDetail?: boolean;
}): Promise<FirebaseIdpSession> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_API_KEY_MISSING");

  const postBody = new URLSearchParams({
    id_token: input.idToken,
    providerId: input.providerId,
  });
  if (input.rawNonce) postBody.set("nonce", input.rawNonce);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: postBody.toString(),
        requestUri: input.requestUri,
        returnSecureToken: true,
        returnIdpCredential: false,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail = "";
    if (input.includeErrorDetail) {
      try {
        detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        detail = "";
      }
    }
    throw new Error(`FIREBASE_AUTH_FAILED_${response.status}${detail ? `_${detail}` : ""}`);
  }
  return (await response.json()) as FirebaseIdpSession;
}

async function resolveActiveFamilyMembership(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<{ memberId: string; role: SessionUser["role"] } | null> {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted") || readString(memberDoc.fields, "status") !== "active") {
      return null;
    }
    return {
      memberId: uid,
      role: readString(memberDoc.fields, "role") === "admin" ? "admin" : "player",
    };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("FIRESTORE_HTTP_404")) throw error;
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const matched = memberDocs.find((doc) =>
    !readBoolean(doc.fields, "deleted") &&
    readString(doc.fields, "status") === "active" &&
    readString(doc.fields, "uid") === uid,
  );
  return matched
    ? {
        memberId: matched.name.split("/").pop() ?? uid,
        role: readString(matched.fields, "role") === "admin" ? "admin" : "player",
      }
    : null;
}

export async function upsertIdpUser(input: {
  session: FirebaseIdpSession;
  identity: VerifiedIdpIdentity;
  provider: AuthProvider;
  touchMemberLastSignIn?: boolean;
}) {
  const { session, identity, provider } = input;
  const now = new Date().toISOString();
  const normalizedEmail = (identity.email ?? session.email ?? "").trim().toLowerCase();
  let existingFamilyIds: string[] = [];
  let existingRole: SessionUser["role"] = "player";
  let existingLocale = "";
  let existingDisplayName = "";
  let hasExistingUserDoc = false;

  try {
    const existing = await getDocument(`users/${session.localId}`, session.idToken);
    hasExistingUserDoc = true;
    existingFamilyIds = readStringArray(existing.fields, "familyIds");
    existingRole = readString(existing.fields, "role") === "admin" ? "admin" : "player";
    existingLocale = readString(existing.fields, "locale").trim();
    existingDisplayName = readString(existing.fields, "displayName").trim();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("FIRESTORE_HTTP_404")) throw error;
  }

  // Family membership resolves by uid alone. The former email fallbacks —
  // inviteLookup/{email} and findFirstFamilyIdByMemberEmail — were removed with
  // the email-keying migration: they could not work for an Apple private-relay
  // address, and matching on an address is what let a second Google account
  // silently land in the wrong family. Anyone without a uid-keyed membership
  // joins through an invite code instead.
  let linkedFamilyId = existingFamilyIds[0] ?? "";
  if (!linkedFamilyId) {
    linkedFamilyId = await findFirstFamilyIdByMemberUid(session.localId, session.idToken);
  }

  // Authentication must not silently manufacture an unrelated family when no
  // membership is found; the caller sends the user to the join-a-family step.
  const familyResolution: FamilyResolution = linkedFamilyId ? "resolved" : "needs_family_setup";
  let familyLocale = "";
  if (linkedFamilyId) {
    try {
      const family = await getDocument(`families/${linkedFamilyId}`, session.idToken);
      familyLocale = readString(family.fields, "defaultLocale").trim();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("FIRESTORE_HTTP_404")) throw error;
    }
  }

  const membership = linkedFamilyId
    ? await resolveActiveFamilyMembership(linkedFamilyId, session.localId, session.idToken)
    : null;
  const role = membership?.role ?? (existingRole === "admin" ? "admin" : "player");
  const locale = resolveLocalePreference({
    requestedLocale: existingLocale,
    familyLocale,
    fallbackLocale: DEFAULT_LOCALE,
  });
  const suppliedName = (identity.name ?? session.displayName ?? "").trim();
  const displayName = provider === "apple"
    ? suppliedName || existingDisplayName
    : identity.name ?? session.displayName ?? "";
  const photoUrl = identity.picture ?? session.photoUrl ?? "";
  // A first-time sign-in with no family resolved is not yet an account: the
  // caller sends these users to the create-or-join step, and most never finish
  // it. Writing `users/{uid}` here left a permanent orphan row (role "player",
  // no familyIds) for every abandoned sign-in. Defer the write instead — the
  // family-setup completion paths create the document through
  // `linkUserPrimaryFamily`, which knows how to satisfy `isValidSelfUserCreate`.
  //
  // Only brand-new accounts are deferred. An existing document is always kept
  // current, including for users who are already orphaned from before this
  // change, so `lastSignInAt` does not silently go stale.
  const userDocDeferred = !hasExistingUserDoc && !linkedFamilyId;
  if (!userDocDeferred) {
    const fields = buildIdpUserAuthFields({
      uid: session.localId,
      role,
      locale,
      email: normalizedEmail,
      displayName,
      photoUrl,
      provider,
      familyId: linkedFamilyId,
      now,
    });
    await patchDocument(`users/${session.localId}`, fields, session.idToken, Object.keys(fields));
  }

  if (linkedFamilyId && input.touchMemberLastSignIn) {
    try {
      await patchDocument(
        `families/${linkedFamilyId}/members/${session.localId}`,
        { lastSignInAt: timestampField(now) },
        session.idToken,
        ["lastSignInAt"],
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404") && !reason.includes("FIRESTORE_HTTP_403")) throw error;
    }
  }

  return {
    role,
    memberId: membership?.memberId ?? session.localId,
    locale,
    normalizedEmail,
    displayName,
    photoUrl,
    isNewUser: !hasExistingUserDoc,
    familyResolution,
    userDocDeferred,
    provider,
  };
}

export function buildIdpSessionUser(
  firebaseSession: FirebaseIdpSession,
  result: Awaited<ReturnType<typeof upsertIdpUser>>,
): SessionUser {
  return {
    uid: firebaseSession.localId,
    memberId: result.memberId,
    role: result.role,
    locale: result.locale,
    email: result.normalizedEmail,
    name: result.displayName,
    picture: result.photoUrl,
    provider: result.provider,
    firebaseIdToken: firebaseSession.idToken,
    firebaseRefreshToken: firebaseSession.refreshToken,
  };
}
