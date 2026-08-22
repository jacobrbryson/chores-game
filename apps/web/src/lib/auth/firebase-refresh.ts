import { getAuthenticatedSessionIdentity, type SessionUser } from "@/lib/auth/session";
import {
  createRequestStore,
  readTiming,
  runWithRequestStore,
  type RequestTiming,
} from "@/lib/observability/request-context";

type FirebaseRefreshResponse = {
  id_token: string;
  refresh_token: string;
  user_id: string;
};

const ID_TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;
const inFlightRefreshes = new Map<string, Promise<SessionUser>>();

function isFirestoreUnauthorizedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("FIRESTORE_HTTP_401");
}

function decodeJwtExpiresAtSeconds(token: string | undefined) {
  if (!token) {
    return 0;
  }

  const [, payload] = token.split(".");
  if (!payload) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp)
      ? parsed.exp
      : 0;
  } catch {
    return 0;
  }
}

function shouldRefreshBeforeFirestore(session: SessionUser) {
  if (!session.firebaseRefreshToken) {
    return false;
  }
  if (!session.firebaseIdToken) {
    return true;
  }
  const expiresAtSeconds = decodeJwtExpiresAtSeconds(session.firebaseIdToken);
  if (!expiresAtSeconds) {
    return false;
  }
  return expiresAtSeconds - Math.floor(Date.now() / 1000) <= ID_TOKEN_REFRESH_SKEW_SECONDS;
}

async function refreshFirebaseSession(session: SessionUser) {
  const authenticated = getAuthenticatedSessionIdentity(session);
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY_MISSING");
  }
  if (!session.firebaseRefreshToken) {
    throw new Error("MISSING_FIREBASE_REFRESH_TOKEN");
  }

  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(
        session.firebaseRefreshToken,
      )}`,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = "";
    }
    throw new Error(
      `FIREBASE_REFRESH_FAILED_${response.status}${detail ? `_${detail}` : ""}`,
    );
  }

  const refreshed = (await response.json()) as FirebaseRefreshResponse;
  if (refreshed.user_id !== authenticated.uid) {
    throw new Error("FIREBASE_REFRESH_UID_MISMATCH");
  }

  return {
    ...session,
    firebaseIdToken: refreshed.id_token,
    firebaseRefreshToken: refreshed.refresh_token,
  } satisfies SessionUser;
}

async function refreshFirebaseSessionOnce(session: SessionUser) {
  const authenticated = getAuthenticatedSessionIdentity(session);
  const refreshKey = `${authenticated.uid}:${session.firebaseRefreshToken ?? ""}`;
  const existing = inFlightRefreshes.get(refreshKey);
  if (existing) {
    return existing;
  }

  const refreshPromise = refreshFirebaseSession(session);
  inFlightRefreshes.set(refreshKey, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inFlightRefreshes.delete(refreshKey);
  }
}

export async function runWithRefreshedFirebaseToken<T>(
  session: SessionUser,
  work: (idToken: string) => Promise<T>,
) {
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    throw new Error("MISSING_FIREBASE_SESSION");
  }

  // Every protected route funnels its Firestore work through here, which makes
  // this the one place to establish the per-request context that powers both the
  // Server-Timing instrumentation and per-request read memoization.
  //
  // A fresh store per attempt is deliberate: on a 401 the callback is retried
  // with a refreshed token, and reusing the first attempt's store would let
  // reads cached under the expired token leak into the retry.
  let timing: RequestTiming = { firestoreCalls: 0, firestoreMs: 0, memoHits: 0, documentsRead: 0 };
  const attempt = async (token: string | undefined) => {
    if (!token) {
      throw new Error("MISSING_FIREBASE_ID_TOKEN");
    }
    const store = createRequestStore();
    try {
      return await runWithRequestStore(store, () => work(token));
    } finally {
      timing = readTiming(store);
    }
  };

  if (shouldRefreshBeforeFirestore(session)) {
    const refreshedSession = await refreshFirebaseSessionOnce(session);
    const data = await attempt(refreshedSession.firebaseIdToken);
    return { data, session: refreshedSession, refreshed: true as const, timing };
  }

  try {
    const data = await attempt(session.firebaseIdToken);
    return { data, session, refreshed: false as const, timing };
  } catch (error) {
    if (
      !isFirestoreUnauthorizedError(error) &&
      !(error instanceof Error && error.message === "MISSING_FIREBASE_ID_TOKEN")
    ) {
      throw error;
    }
  }

  const refreshedSession = await refreshFirebaseSessionOnce(session);
  const data = await attempt(refreshedSession.firebaseIdToken);
  return { data, session: refreshedSession, refreshed: true as const, timing };
}
