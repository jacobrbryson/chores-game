import { createHash } from "node:crypto";
import {
  getAuthenticatedSessionIdentity,
  type SessionIdentity,
  type SessionUser,
} from "@/lib/auth/session";
import {
  createOrReplaceDocument,
  documentIdFromName,
  findFirstFamilyIdByMemberUid,
  getDocument,
  integerField,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  findColorThemeOptionById,
} from "@/lib/store/catalog";

function getPinSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET_MISSING");
  }
  return secret;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashPin(uid: string, pin: string) {
  return createHash("sha256")
    .update(`${getPinSecret()}:${uid}:${pin}`)
    .digest("base64url");
}

export function normalizeAccountSwitchPin(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return /^\d{4}$/.test(normalized) ? normalized : "";
}

export async function setAccountSwitchPin(uid: string, pin: string, idToken: string) {
  const now = new Date().toISOString();
  await patchDocument(
    `users/${uid}`,
    {
      accountSwitchPinHash: stringField(hashPin(uid, pin)),
      accountSwitchPinUpdatedAt: timestampField(now),
    },
    idToken,
    ["accountSwitchPinHash", "accountSwitchPinUpdatedAt"],
  );
}

export async function verifyAccountSwitchPin(uid: string, pin: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const storedHash = readString(userDoc.fields, "accountSwitchPinHash").trim();
  if (!storedHash) {
    return { ok: false as const, reason: "pin_not_configured" as const };
  }
  if (hashPin(uid, pin) !== storedHash) {
    return { ok: false as const, reason: "invalid_pin" as const };
  }
  return { ok: true as const };
}

export async function getPrimaryFamilyIdForSession(session: SessionUser, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${session.uid}`, idToken);
    const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
    if (familyId) {
      return familyId;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  return findFirstFamilyIdByMemberUid(session.uid, idToken);
}

export type FamilyMemberSessionIdentity = SessionIdentity & {
  lastSignInAt?: string;
  linkedAccount: boolean;
};

export async function resolveFamilyMemberSessionIdentity(
  familyId: string,
  memberId: string,
  idToken: string,
): Promise<FamilyMemberSessionIdentity | null> {
  const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
  if (readBoolean(memberDoc.fields, "deleted")) {
    return null;
  }
  const role = readString(memberDoc.fields, "role") === "admin" ? "admin" : "player";
  const linkedUid = readString(memberDoc.fields, "uid").trim() || memberId;
  const email = readString(memberDoc.fields, "email").trim().toLowerCase();
  const name = readString(memberDoc.fields, "name") || "Family member";
  const picture = readString(memberDoc.fields, "avatarPhotoUrl").trim();
  let linkedAccount = false;
  try {
    const userDoc = await getDocument(`users/${linkedUid}`, idToken);
    linkedAccount = readString(userDoc.fields, "provider") === "google";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  return {
    uid: linkedUid,
    memberId,
    role,
    email,
    name,
    picture,
    linkedAccount,
    lastSignInAt: readTimestamp(memberDoc.fields, "lastSignInAt") || undefined,
  };
}

export async function ensureManagedChildProfile(
  familyId: string,
  memberId: string,
  idToken: string,
): Promise<FamilyMemberSessionIdentity | null> {
  const memberIdentity = await resolveFamilyMemberSessionIdentity(familyId, memberId, idToken);
  if (!memberIdentity || memberIdentity.role !== "player") {
    return memberIdentity;
  }

  const defaultTheme = findColorThemeOptionById(DEFAULT_COLOR_THEME_OPTION_ID)?.theme ?? {
    primary: "#0072b2",
    secondary: "#56b4e9",
    tertiary: "#1b2a41",
  };
  const now = new Date().toISOString();
  const localUid = memberIdentity.uid || memberIdentity.memberId;

  try {
    await getDocument(`users/${localUid}`, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
    await createOrReplaceDocument(
      `users/${localUid}`,
      {
        uid: stringField(localUid),
        role: stringField("player"),
        provider: stringField("local"),
        email: stringField(memberIdentity.email),
        displayName: stringField(memberIdentity.name),
        familyIds: stringArrayField([familyId]),
        walletBalance: integerField(0),
        ownedStoreOptionIds: stringArrayField([
          DEFAULT_COLOR_THEME_OPTION_ID,
          DEFAULT_CONFETTI_OPTION_ID,
        ]),
        preferencesThemeOptionId: stringField(DEFAULT_COLOR_THEME_OPTION_ID),
        preferencesThemePrimaryColor: stringField(defaultTheme.primary),
        preferencesThemeSecondaryColor: stringField(defaultTheme.secondary),
        preferencesThemeTertiaryColor: stringField(defaultTheme.tertiary),
        selectedConfettiOptionId: stringField(DEFAULT_CONFETTI_OPTION_ID),
        createdAt: timestampField(now),
        lastFamilyUpdateAt: timestampField(now),
        storeUpdatedAt: timestampField(now),
        preferencesUpdatedAt: timestampField(now),
      },
      idToken,
    );
  }

  await patchDocument(
    `families/${familyId}/members/${memberId}`,
    {
      uid: stringField(localUid),
      status: stringField("active"),
      updatedAt: timestampField(now),
    },
    idToken,
    ["uid", "status", "updatedAt"],
  );

  return {
    ...memberIdentity,
    uid: localUid,
  };
}

export async function resolveFamilyMemberIdentityByUid(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<FamilyMemberSessionIdentity | null> {
  const members = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const normalizedUid = uid.trim();
  const matched = members.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    return readString(doc.fields, "uid").trim() === normalizedUid;
  });
  if (!matched) {
    return null;
  }
  return resolveFamilyMemberSessionIdentity(
    familyId,
    documentIdFromName(matched.name),
    idToken,
  );
}

export function getAuthenticatedUid(session: SessionUser) {
  return getAuthenticatedSessionIdentity(session).uid;
}

export function getAuthenticatedRole(session: SessionUser) {
  return getAuthenticatedSessionIdentity(session).role;
}

export function getAuthenticatedName(session: SessionUser) {
  return getAuthenticatedSessionIdentity(session).name;
}

export function getAuthenticatedEmail(session: SessionUser) {
  return normalizeEmail(getAuthenticatedSessionIdentity(session).email);
}
