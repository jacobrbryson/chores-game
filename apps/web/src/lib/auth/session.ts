import { createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULT_LOCALE, type AppLocale } from "@packages/locales";

export type SessionRole = "admin" | "player";

export type SessionIdentity = {
  uid: string;
  memberId: string;
  role: SessionRole;
  email: string;
  name: string;
  picture: string;
  locale: AppLocale;
};

export type SessionUser = {
  uid: string;
  memberId: string;
  role: SessionRole;
  email: string;
  name: string;
  picture: string;
  locale: AppLocale;
  firebaseIdToken?: string;
  firebaseRefreshToken?: string;
  authUid?: string;
  authMemberId?: string;
  authRole?: SessionRole;
  authEmail?: string;
  authName?: string;
  authPicture?: string;
  authLocale?: AppLocale;
  // Family Kiosk Mode: when true the session is operating as a shared-tablet
  // kiosk. The current identity is always a player profile while the original
  // signed-in account is preserved in the auth* fields. Kiosk sessions are
  // always player-level regardless of the authenticated account's real role.
  kioskActive?: boolean;
  // The pre-authorized roster of player member ids selected when Kiosk Mode was
  // started. The active player may be switched freely among this roster without
  // a PIN (they were all approved up front); exiting still requires the PIN.
  kioskPlayerIds?: string[];
};

type SessionPayload = SessionUser & {
  exp: number;
};

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  return secret;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function getSessionIdentity(session: SessionUser): SessionIdentity {
  return {
    uid: session.uid,
    memberId: session.memberId || session.uid,
    role: session.role,
    email: session.email,
    name: session.name,
    picture: session.picture,
    locale: session.locale,
  };
}

export function getAuthenticatedSessionIdentity(session: SessionUser): SessionIdentity {
  return {
    uid: session.authUid || session.uid,
    memberId: session.authMemberId || session.memberId || session.uid,
    role: session.authRole || session.role,
    email: session.authEmail || session.email,
    name: session.authName || session.name,
    picture: session.authPicture || session.picture,
    locale: session.authLocale || session.locale,
  };
}

export function isSessionSwitched(session: SessionUser) {
  const current = getSessionIdentity(session);
  const authenticated = getAuthenticatedSessionIdentity(session);
  return current.uid !== authenticated.uid || current.memberId !== authenticated.memberId;
}

export function createSessionFromIdentity(
  identity: SessionIdentity,
  extras?: Pick<SessionUser, "firebaseIdToken" | "firebaseRefreshToken">,
): SessionUser {
  return {
    ...identity,
    memberId: identity.memberId || identity.uid,
    firebaseIdToken: extras?.firebaseIdToken,
    firebaseRefreshToken: extras?.firebaseRefreshToken,
  };
}

export function switchSessionIdentity(
  session: SessionUser,
  identity: SessionIdentity,
): SessionUser {
  const authenticated = getAuthenticatedSessionIdentity(session);
  return {
    ...session,
    ...identity,
    memberId: identity.memberId || identity.uid,
    authUid: authenticated.uid,
    authMemberId: authenticated.memberId,
    authRole: authenticated.role,
    authEmail: authenticated.email,
    authName: authenticated.name,
    authPicture: authenticated.picture,
    authLocale: authenticated.locale,
  };
}

export function restoreAuthenticatedSession(session: SessionUser): SessionUser {
  const authenticated = getAuthenticatedSessionIdentity(session);
  return {
    uid: authenticated.uid,
    memberId: authenticated.memberId,
    role: authenticated.role,
    email: authenticated.email,
    name: authenticated.name,
    picture: authenticated.picture,
    locale: authenticated.locale,
    firebaseIdToken: session.firebaseIdToken,
    firebaseRefreshToken: session.firebaseRefreshToken,
  };
}

export function isKioskActive(session: SessionUser) {
  return Boolean(session.kioskActive);
}

export function getKioskPlayerIds(session: SessionUser): string[] {
  return Array.isArray(session.kioskPlayerIds) ? session.kioskPlayerIds : [];
}

export function normalizeKioskRoster(playerIds: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const roster: string[] = [];
  for (const value of playerIds) {
    const trimmed = (value ?? "").trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      roster.push(trimmed);
    }
  }
  return roster;
}

// Enter (or switch player within) Kiosk Mode. The current identity becomes the
// selected player while the original signed-in account is preserved in the
// auth* fields (switchSessionIdentity is idempotent: when already switched it
// keeps the existing authenticated identity). Kiosk sessions are always marked
// active so the UI can render kiosk chrome and server code can tag events. The
// roster (the multi-selected players approved for this tablet) is preserved so
// the active player can be switched among them without re-entering the PIN.
export function enterKioskSession(
  session: SessionUser,
  playerIdentity: SessionIdentity,
  playerIds: Array<string | undefined> = [],
): SessionUser {
  // Use the explicitly approved roster (the active player is always already a
  // member of it). Fall back to just the active player when no roster is given.
  const normalized = normalizeKioskRoster(playerIds);
  const roster = normalized.length > 0 ? normalized : normalizeKioskRoster([playerIdentity.memberId]);
  return {
    ...switchSessionIdentity(session, { ...playerIdentity, role: "player" }),
    kioskActive: true,
    kioskPlayerIds: roster,
  };
}

// Exit Kiosk Mode and return to the original authenticated account with its
// normal permissions. Clears the kiosk flag and all auth* shadow fields.
export function exitKioskSession(session: SessionUser): SessionUser {
  const restored = restoreAuthenticatedSession(session);
  return { ...restored, kioskActive: false };
}

export function createSessionToken(user: SessionUser) {
  const secret = getSecret();
  if (!secret) {
    return null;
  }

  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function parseSessionToken(token: string | undefined): SessionUser | null {
  const secret = getSecret();
  if (!secret || !token) {
    return null;
  }

  const [encodedPayload, providedSig] = token.split(".");
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = sign(encodedPayload, secret);
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(providedSig);
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      uid: parsed.uid,
      memberId: parsed.memberId || parsed.uid,
      role: parsed.role,
      email: parsed.email,
      name: parsed.name,
      picture: parsed.picture,
      locale: parsed.locale || DEFAULT_LOCALE,
      firebaseIdToken: parsed.firebaseIdToken,
      firebaseRefreshToken: parsed.firebaseRefreshToken,
      authUid: parsed.authUid,
      authMemberId: parsed.authMemberId,
      authRole: parsed.authRole,
      authEmail: parsed.authEmail,
      authName: parsed.authName,
      authPicture: parsed.authPicture,
      authLocale: parsed.authLocale,
      kioskActive: parsed.kioskActive === true,
      kioskPlayerIds: Array.isArray(parsed.kioskPlayerIds)
        ? parsed.kioskPlayerIds.filter((entry): entry is string => typeof entry === "string")
        : undefined,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE = SESSION_MAX_AGE_SECONDS;
