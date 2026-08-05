import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetInvite } = vi.hoisted(() => ({ mockGetInvite: vi.fn() }));

vi.mock("@/lib/family-friends/repository", () => ({
  getFamilyFriendInvite: mockGetInvite,
}));

import { GET } from "@/app/api/family-friends/invitations/email-confirm/route";
import { hashFamilyFriendToken } from "@/lib/family-friends/model";

// The email CTA hits this route on a Cloud Run container whose request URL is
// the internal bind address, so every redirect must be rebuilt on the canonical
// origin or the click lands on a host that does not resolve.
function requestFor(url: string) {
  const request = new Request(url) as any;
  request.nextUrl = new URL(url.replace("https://0.0.0.0:8080", "https://app.example.com"));
  return request;
}

describe("GET /api/family-friends/invitations/email-confirm", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("redirects a valid invite to the canonical origin and stores the pending cookie", async () => {
    const token = "token-1";
    mockGetInvite.mockResolvedValue({
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      tokenHash: hashFamilyFriendToken(token),
    });

    const response = await GET(
      requestFor(
        `https://0.0.0.0:8080/api/family-friends/invitations/email-confirm?invite=invite-1&token=${token}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?friendInvite=invite-1",
    );
    expect(response.cookies.get("pending_family_friend_invite")?.value).toBe("invite-1");
  });

  it("redirects an unknown invite to the canonical origin", async () => {
    mockGetInvite.mockResolvedValue(null);

    const response = await GET(
      requestFor(
        "https://0.0.0.0:8080/api/family-friends/invitations/email-confirm?invite=nope&token=nope",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?friendInvite=invalid",
    );
  });

  it("redirects to the canonical origin when parameters are missing", async () => {
    const response = await GET(
      requestFor("https://0.0.0.0:8080/api/family-friends/invitations/email-confirm"),
    );

    expect(mockGetInvite).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?friendInvite=invalid",
    );
  });
});
