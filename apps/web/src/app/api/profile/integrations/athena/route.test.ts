import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockConnectAthena,
  mockDisconnectAthena,
  mockGetAthenaConfig,
  mockIsAthenaConfigured,
  mockGetAthenaConnection,
  mockSaveAthenaConnection,
  mockClearAthenaConnection,
  mockCreateApiToken,
  mockUpdateApiTokenStatus,
  mockResolveUserFamily,
  mockGetApiTokenById,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockConnectAthena: vi.fn(),
  mockDisconnectAthena: vi.fn(),
  mockGetAthenaConfig: vi.fn(),
  mockIsAthenaConfigured: vi.fn(),
  mockGetAthenaConnection: vi.fn(),
  mockSaveAthenaConnection: vi.fn(),
  mockClearAthenaConnection: vi.fn(),
  mockCreateApiToken: vi.fn(),
  mockUpdateApiTokenStatus: vi.fn(),
  mockResolveUserFamily: vi.fn(),
  mockGetApiTokenById: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSession,
}));

// Keep the real AthenaIntegrationError / constants so `instanceof` works in the
// route, but stub the network-touching functions.
vi.mock("@/lib/integrations/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/athena")>(
    "@/lib/integrations/athena",
  );
  return {
    ...actual,
    connectAthena: mockConnectAthena,
    disconnectAthena: mockDisconnectAthena,
    getAthenaConfig: mockGetAthenaConfig,
    isAthenaConfigured: mockIsAthenaConfigured,
  };
});

vi.mock("@/lib/integrations/athena-store", () => ({
  getAthenaConnection: mockGetAthenaConnection,
  saveAthenaConnection: mockSaveAthenaConnection,
  clearAthenaConnection: mockClearAthenaConnection,
}));

vi.mock("@/lib/public-api/tokens", () => ({
  createApiToken: mockCreateApiToken,
  updateApiTokenStatus: mockUpdateApiTokenStatus,
  resolveUserFamilyForApiToken: mockResolveUserFamily,
  getApiTokenById: mockGetApiTokenById,
  getClientIp: () => "127.0.0.1",
}));

import { AthenaIntegrationError } from "@/lib/integrations/athena";
import { DELETE, POST } from "@/app/api/profile/integrations/athena/route";

const ADMIN = { uid: "admin-1", role: "admin", email: "parent@example.com" };

function postRequest() {
  return new Request("http://localhost/api/profile/integrations/athena", { method: "POST" }) as never;
}

function deleteRequest() {
  return new Request("http://localhost/api/profile/integrations/athena", { method: "DELETE" }) as never;
}

const CONFIG = {
  proxyBaseUrl: "https://athena.example.com",
  partnerKey: "secret",
  apiBaseUrl: "https://api.familychores.app",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAthenaConfig.mockReturnValue(CONFIG);
  mockIsAthenaConfigured.mockReturnValue(true);
  mockResolveUserFamily.mockResolvedValue({
    familyId: "fam-1",
    familyName: "The Smiths",
    viewerRole: "admin",
    viewerMemberId: "admin-1",
  });
  mockCreateApiToken.mockResolvedValue({
    token: { id: "tok-1", userId: "admin-1", familyId: "fam-1", status: "active" },
    rawToken: "fc_live_abc_secret",
  });
  mockUpdateApiTokenStatus.mockResolvedValue(undefined);
  mockSaveAthenaConnection.mockResolvedValue(undefined);
});

describe("POST /api/profile/integrations/athena (connect)", () => {
  it("mints a scoped token, links via Athena, and persists (201)", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConnection
      .mockResolvedValueOnce(null) // pre-check: not connected
      .mockResolvedValueOnce({
        connected: true,
        email: "parent@example.com",
        displayName: "Pip",
        playerId: "player-1",
        familyName: "The Smiths",
        createdAccount: true,
        connectedAt: "2026-06-16T00:00:00.000Z",
      });
    mockConnectAthena.mockResolvedValue({
      success: true,
      connected: true,
      created_account: true,
      email: "parent@example.com",
      display_name: "Pip",
      player_id: "player-1",
      family_name: "The Smiths",
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.connected).toBe(true);
    // Minted token must be read-only and minimally scoped.
    expect(mockCreateApiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        familyId: "fam-1",
        scopes: ["read:profile", "read:players", "read:coins", "read:chores"],
      }),
    );
    // Athena receives the raw token + our public base URL.
    expect(mockConnectAthena).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "fc_live_abc_secret", baseUrl: "https://api.familychores.app" }),
    );
    expect(mockSaveAthenaConnection).toHaveBeenCalledWith(
      "fam-1",
      expect.objectContaining({ apiTokenId: "tok-1", createdAccount: true }),
    );
    // No revoke on the happy path.
    expect(mockUpdateApiTokenStatus).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockReturnValue(null);
    const response = await POST(postRequest());
    expect(response.status).toBe(401);
    expect(mockCreateApiToken).not.toHaveBeenCalled();
  });

  it("returns 403 for a child/player account and never mints a token", async () => {
    mockGetSession.mockReturnValue({ uid: "kid-1", role: "player", email: "kid@example.com" });
    const response = await POST(postRequest());
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.message).toMatch(/parent or admin/i);
    expect(mockCreateApiToken).not.toHaveBeenCalled();
    expect(mockConnectAthena).not.toHaveBeenCalled();
  });

  it("returns 400 when the admin has no email on file", async () => {
    mockGetSession.mockReturnValue({ uid: "admin-1", role: "admin", email: "" });
    const response = await POST(postRequest());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.message).toMatch(/email/i);
    expect(mockCreateApiToken).not.toHaveBeenCalled();
  });

  it("returns 502 (generic) and never mints when config is missing", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConfig.mockImplementation(() => {
      throw new AthenaIntegrationError("config_error", "Connection failed, please try again later.", 502, "missing");
    });
    const response = await POST(postRequest());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.error).toBe("config_error");
    expect(mockCreateApiToken).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_request", 400],
    ["forbidden", 403],
    ["config_error", 502],
    ["upstream_error", 502],
  ] as const)("revokes the minted token and surfaces %s when Athena rejects", async (code, status) => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConnection.mockResolvedValueOnce(null);
    mockConnectAthena.mockRejectedValue(new AthenaIntegrationError(code, "msg", status, "detail"));

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error).toBe(code);
    // Orphan token cleanup.
    expect(mockUpdateApiTokenStatus).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", token: expect.objectContaining({ id: "tok-1" }) }),
    );
    expect(mockSaveAthenaConnection).not.toHaveBeenCalled();
  });

  it("is idempotent: returns current state without re-minting when already connected", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConnection.mockResolvedValueOnce({
      connected: true,
      email: "parent@example.com",
      displayName: "Pip",
      playerId: "player-1",
      familyName: "The Smiths",
      createdAccount: false,
      connectedAt: "2026-06-16T00:00:00.000Z",
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connected).toBe(true);
    expect(mockCreateApiToken).not.toHaveBeenCalled();
    expect(mockConnectAthena).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/profile/integrations/athena (disconnect)", () => {
  it("calls Athena, revokes the issued token, and clears local state", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConnection.mockResolvedValue({
      connected: true,
      email: "parent@example.com",
      apiTokenId: "tok-1",
    });
    mockDisconnectAthena.mockResolvedValue({ success: true, disconnected: true });
    mockGetApiTokenById.mockResolvedValue({ id: "tok-1", status: "active" });

    const response = await DELETE(deleteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connected).toBe(false);
    expect(mockDisconnectAthena).toHaveBeenCalledWith({ email: "parent@example.com" });
    expect(mockUpdateApiTokenStatus).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", token: expect.objectContaining({ id: "tok-1" }) }),
    );
    expect(mockClearAthenaConnection).toHaveBeenCalledWith("fam-1");
  });

  it("still revokes + clears locally even if Athena's disconnect fails", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetAthenaConnection.mockResolvedValue({
      connected: true,
      email: "parent@example.com",
      apiTokenId: "tok-1",
    });
    mockDisconnectAthena.mockRejectedValue(new AthenaIntegrationError("upstream_error", "down", 502, "x"));
    mockGetApiTokenById.mockResolvedValue({ id: "tok-1", status: "active" });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mockUpdateApiTokenStatus).toHaveBeenCalled();
    expect(mockClearAthenaConnection).toHaveBeenCalledWith("fam-1");
  });

  it("returns 403 for a child/player account", async () => {
    mockGetSession.mockReturnValue({ uid: "kid-1", role: "player", email: "kid@example.com" });
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(403);
    expect(mockClearAthenaConnection).not.toHaveBeenCalled();
  });
});
