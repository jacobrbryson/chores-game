import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithRefreshedFirebaseToken } from "./firebase-refresh";
import type { SessionUser } from "./session";

const ORIGINAL_ENV = process.env;

function tokenWithExp(exp: number) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function sessionWithToken(idToken: string): SessionUser {
  return {
    uid: "user-1",
    memberId: "user-1",
    role: "admin",
    email: "parent@example.com",
    name: "Parent",
    picture: "",
    locale: "en-US",
    firebaseIdToken: idToken,
    firebaseRefreshToken: "refresh-token",
  };
}

describe("runWithRefreshedFirebaseToken", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, FIREBASE_WEB_API_KEY: "firebase-api-key" };
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id_token: tokenWithExp(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: "next-refresh-token",
          user_id: "user-1",
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.env = ORIGINAL_ENV;
  });

  it("uses a valid current ID token without refreshing", async () => {
    const session = sessionWithToken(tokenWithExp(Math.floor(Date.now() / 1000) + 3600));
    const work = vi.fn(async () => "ok");

    const result = await runWithRefreshedFirebaseToken(session, work);

    // `timing` carries the per-request Firestore instrumentation (see
    // request-context.ts). The callback here makes no Firestore calls, so the
    // counters are zero.
    expect(result).toEqual({
      data: "ok",
      session,
      refreshed: false,
      timing: { firestoreCalls: 0, firestoreMs: 0, memoHits: 0 },
    });
    expect(work).toHaveBeenCalledWith(session.firebaseIdToken);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes before work when the ID token is expired", async () => {
    const session = sessionWithToken(tokenWithExp(Math.floor(Date.now() / 1000) - 60));
    const work = vi.fn(async () => "ok");

    const result = await runWithRefreshedFirebaseToken(session, work);

    expect(result.refreshed).toBe(true);
    expect(result.session.firebaseRefreshToken).toBe("next-refresh-token");
    expect(work).toHaveBeenCalledWith(result.session.firebaseIdToken);
    expect(work).not.toHaveBeenCalledWith(session.firebaseIdToken);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refreshes for the same refresh token", async () => {
    const session = sessionWithToken(tokenWithExp(Math.floor(Date.now() / 1000) - 60));
    const work = vi.fn(async () => "ok");

    const [first, second] = await Promise.all([
      runWithRefreshedFirebaseToken(session, work),
      runWithRefreshedFirebaseToken(session, work),
    ]);

    expect(first.refreshed).toBe(true);
    expect(second.refreshed).toBe(true);
    expect(first.session.firebaseRefreshToken).toBe("next-refresh-token");
    expect(second.session.firebaseRefreshToken).toBe("next-refresh-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
