import { NextRequest, NextResponse } from "next/server";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import type { SessionUser } from "@/lib/auth/session";
import { createFamilyForUser } from "@/lib/family/bootstrap";
import {
  findFirstFamilyIdByMemberEmail,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type GoogleTokenInfo = {
  aud: string;
  email?: string;
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
  if (!response.ok) {
    throw new Error(`GOOGLE_TOKENINFO_HTTP_${response.status}`);
  }
  const tokenInfo = (await response.json()) as GoogleTokenInfo;
  const allowedAudiences = getAllowedGoogleAudiences();
  if (allowedAudiences.length === 0) {
    throw new Error("GOOGLE_CLIENT_ID_MISSING");
  }
  if (!allowedAudiences.includes(tokenInfo.aud)) {
    throw new Error("GOOGLE_AUDIENCE_MISMATCH");
  }
  return tokenInfo;
}

async function signInWithFirebase(googleIdToken: string) {
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
        requestUri: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        returnSecureToken: true,
        returnIdpCredential: false,
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`FIREBASE_AUTH_FAILED_${response.status}`);
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
    if (readBoolean(memberDoc.fields, "deleted")) return null;
    if (readString(memberDoc.fields, "status") !== "active") return null;
    return {
      memberId: uid,
      role: readString(memberDoc.fields, "role") === "admin" ? "admin" : "player",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) throw error;
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) return false;
    if (readString(doc.fields, "status") !== "active") return false;
    return readString(doc.fields, "uid") === uid;
  });
  if (!matchedMember) return null;
  return {
    memberId: matchedMember.name.split("/").pop() ?? uid,
    role: readString(matchedMember.fields, "role") === "admin" ? "admin" : "player",
  };
}

async function upsertFirebaseUser(session: FirebaseSession, tokenInfo: GoogleTokenInfo) {
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
    if (!reason.includes("FIRESTORE_HTTP_404")) throw error;
  }

  let linkedFamilyId = existingFamilyIds[0] ?? "";
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
    ...(linkedFamilyId ? { familyIds: stringArrayField([linkedFamilyId]), lastFamilyUpdateAt: timestampField(now) } : {}),
  };
  await patchDocument(`users/${session.localId}`, authFields, session.idToken, Object.keys(authFields));

  return {
    role: effectiveRole,
    memberId: linkedFamilyMembership?.memberId ?? session.localId,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { idToken?: string };
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "missing_id_token" }, { status: 400 });
  }

  try {
    const tokenInfo = await verifyGoogleCredential(idToken);
    const firebaseSession = await signInWithFirebase(idToken);
    const normalizedEmail = (tokenInfo.email ?? firebaseSession.email ?? "").trim().toLowerCase();
    const result = await upsertFirebaseUser(firebaseSession, tokenInfo);
    const response = NextResponse.json({
      ok: true,
      data: {
        uid: firebaseSession.localId,
        role: result.role,
        email: normalizedEmail,
        name: tokenInfo.name ?? firebaseSession.displayName ?? "",
      },
    });
    setSessionUserCookie(response, {
      uid: firebaseSession.localId,
      memberId: result.memberId,
      role: result.role,
      email: normalizedEmail,
      name: tokenInfo.name ?? firebaseSession.displayName ?? "",
      picture: tokenInfo.picture ?? firebaseSession.photoUrl ?? "",
      firebaseIdToken: firebaseSession.idToken,
      firebaseRefreshToken: firebaseSession.refreshToken,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 120) : "unknown";
    console.error("[MOBILE_GOOGLE_AUTH_ERROR]", reason);
    return NextResponse.json({ ok: false, error: "google_signin_failed" }, { status: 401 });
  }
}
