import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionRole = "admin" | "player";

export type SessionIdentity = {
  uid: string;
  memberId: string;
  role: SessionRole;
  email: string;
  name: string;
  picture: string;
};

export type SessionUser = {
  uid: string;
  memberId: string;
  role: SessionRole;
  email: string;
  name: string;
  picture: string;
  firebaseIdToken?: string;
  firebaseRefreshToken?: string;
  authUid?: string;
  authMemberId?: string;
  authRole?: SessionRole;
  authEmail?: string;
  authName?: string;
  authPicture?: string;
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
    firebaseIdToken: session.firebaseIdToken,
    firebaseRefreshToken: session.firebaseRefreshToken,
  };
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
      firebaseIdToken: parsed.firebaseIdToken,
      firebaseRefreshToken: parsed.firebaseRefreshToken,
      authUid: parsed.authUid,
      authMemberId: parsed.authMemberId,
      authRole: parsed.authRole,
      authEmail: parsed.authEmail,
      authName: parsed.authName,
      authPicture: parsed.authPicture,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE = SESSION_MAX_AGE_SECONDS;
