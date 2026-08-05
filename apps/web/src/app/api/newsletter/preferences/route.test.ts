import { describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockRunWithRefreshedFirebaseToken,
  mockSetSessionUserCookie,
  mockGetPreferences,
  mockUpdatePreferences,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRunWithRefreshedFirebaseToken: vi.fn(),
  mockSetSessionUserCookie: vi.fn(),
  mockGetPreferences: vi.fn(),
  mockUpdatePreferences: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSession,
}));
vi.mock("@/lib/auth/firebase-refresh", () => ({
  runWithRefreshedFirebaseToken: mockRunWithRefreshedFirebaseToken,
}));
vi.mock("@/lib/auth/session-cookie", () => ({
  setSessionUserCookie: mockSetSessionUserCookie,
}));
vi.mock("@/lib/newsletters/preferences", () => ({
  getNewsletterPreferences: mockGetPreferences,
  updateNewsletterPreferences: mockUpdatePreferences,
}));

import { GET, PATCH } from "@/app/api/newsletter/preferences/route";

describe("/api/newsletter/preferences", () => {
  it("loads the current preference", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (_session, callback) => ({
      data: await callback("token"),
      session: { uid: "user-1" },
      refreshed: false,
    }));
    mockGetPreferences.mockResolvedValue({ weeklyFamilyHighlightsEmail: true, locale: "en-US" });

    const response = await GET(new Request("http://localhost/api/newsletter/preferences") as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weeklyFamilyHighlightsEmail).toBe(true);
  });

  it("updates the preference", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (_session, callback) => ({
      data: await callback("token"),
      session: { uid: "user-1" },
      refreshed: false,
    }));
    mockUpdatePreferences.mockResolvedValue({ weeklyFamilyHighlightsEmail: false });

    const response = await PATCH(new Request("http://localhost/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weeklyFamilyHighlightsEmail: false }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weeklyFamilyHighlightsEmail).toBe(false);
  });

  it("updates the family friend invite preference on its own", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });
    mockRunWithRefreshedFirebaseToken.mockImplementation(async (_session, callback) => ({
      data: await callback("token"),
      session: { uid: "user-1" },
      refreshed: false,
    }));
    mockUpdatePreferences.mockResolvedValue({
      weeklyFamilyHighlightsEmail: true,
      familyFriendInviteEmail: false,
    });

    const response = await PATCH(new Request("http://localhost/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyFriendInviteEmail: false }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.familyFriendInviteEmail).toBe(false);
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ familyFriendInviteEmail: false, weeklyFamilyHighlightsEmail: undefined }),
    );
  });

  it("rejects invalid payloads", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });

    const response = await PATCH(new Request("http://localhost/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weeklyFamilyHighlightsEmail: "yes" }),
    }) as any);

    expect(response.status).toBe(400);
  });

  it("rejects a non-boolean family friend invite preference", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });

    const response = await PATCH(new Request("http://localhost/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyFriendInviteEmail: 1 }),
    }) as any);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_family_friend_invite_email");
  });

  it("rejects an empty preference payload", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", firebaseIdToken: "token" });

    const response = await PATCH(new Request("http://localhost/api/newsletter/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as any);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("no_preferences_provided");
  });
});
