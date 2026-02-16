import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionUser = {
  uid: string;
  role: "admin" | "player";
  email: string;
  name: string;
  picture: string;
  firebaseIdToken?: string;
  firebaseRefreshToken?: string;
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
      role: parsed.role,
      email: parsed.email,
      name: parsed.name,
      picture: parsed.picture,
      firebaseIdToken: parsed.firebaseIdToken,
      firebaseRefreshToken: parsed.firebaseRefreshToken,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_MAX_AGE = SESSION_MAX_AGE_SECONDS;
