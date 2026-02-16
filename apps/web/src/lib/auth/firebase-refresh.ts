import type { SessionUser } from "@/lib/auth/session";

type FirebaseRefreshResponse = {
  id_token: string;
  refresh_token: string;
  user_id: string;
};

function isFirestoreUnauthorizedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("FIRESTORE_HTTP_401");
}

async function refreshFirebaseSession(session: SessionUser) {
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
  if (refreshed.user_id !== session.uid) {
    throw new Error("FIREBASE_REFRESH_UID_MISMATCH");
  }

  return {
    ...session,
    firebaseIdToken: refreshed.id_token,
    firebaseRefreshToken: refreshed.refresh_token,
  } satisfies SessionUser;
}

export async function runWithRefreshedFirebaseToken<T>(
  session: SessionUser,
  work: (idToken: string) => Promise<T>,
) {
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    throw new Error("MISSING_FIREBASE_SESSION");
  }

  const attempt = async (token: string | undefined) => {
    if (!token) {
      throw new Error("MISSING_FIREBASE_ID_TOKEN");
    }
    return work(token);
  };

  try {
    const data = await attempt(session.firebaseIdToken);
    return { data, session, refreshed: false as const };
  } catch (error) {
    if (
      !isFirestoreUnauthorizedError(error) &&
      !(error instanceof Error && error.message === "MISSING_FIREBASE_ID_TOKEN")
    ) {
      throw error;
    }
  }

  const refreshedSession = await refreshFirebaseSession(session);
  const data = await attempt(refreshedSession.firebaseIdToken);
  return { data, session: refreshedSession, refreshed: true as const };
}
