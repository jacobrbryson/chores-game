import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockAdminGetDocument,
  mockConnectChild,
  mockDisconnectChild,
  mockGetConnection,
  mockGetChildLink,
  mockSaveChildLink,
  mockDeleteChildLink,
  mockResolveUserFamily,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAdminGetDocument: vi.fn(),
  mockConnectChild: vi.fn(),
  mockDisconnectChild: vi.fn(),
  mockGetConnection: vi.fn(),
  mockGetChildLink: vi.fn(),
  mockSaveChildLink: vi.fn(),
  mockDeleteChildLink: vi.fn(),
  mockResolveUserFamily: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mockGetSession }));
vi.mock("@/lib/firestore/admin", () => ({ adminGetDocument: mockAdminGetDocument }));
vi.mock("@/lib/integrations/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/athena")>(
    "@/lib/integrations/athena",
  );
  return {
    ...actual,
    connectAthenaChild: mockConnectChild,
    disconnectAthenaChild: mockDisconnectChild,
  };
});
vi.mock("@/lib/integrations/athena-store", () => ({
  getAthenaConnection: mockGetConnection,
  getAthenaChildLink: mockGetChildLink,
  saveAthenaChildLink: mockSaveChildLink,
  deleteAthenaChildLink: mockDeleteChildLink,
}));
vi.mock("@/lib/public-api/tokens", () => ({
  resolveUserFamilyForApiToken: mockResolveUserFamily,
}));

import { AthenaIntegrationError } from "@/lib/integrations/athena";
import { DELETE, POST } from "@/app/api/profile/integrations/athena/children/[playerId]/route";

const ADMIN = { uid: "admin-1", role: "admin", email: "parent@example.com" };
const ctx = { params: Promise.resolve({ playerId: "child-1" }) };

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/profile/integrations/athena/children/child-1", {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }) as never;
}

function memberDoc(role = "player", name = "Pip", email = "") {
  return {
    fields: {
      name: { stringValue: name },
      role: { stringValue: role },
      email: { stringValue: email },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveUserFamily.mockResolvedValue({ familyId: "fam-1", familyName: "Smiths", viewerRole: "admin" });
  mockGetConnection.mockResolvedValue({ connected: true });
  mockAdminGetDocument.mockResolvedValue(memberDoc("player", "Pip", "pip@example.com"));
  mockSaveChildLink.mockResolvedValue(undefined);
});

describe("POST .../athena/children/[playerId] (enable)", () => {
  it("links the child and persists on success (201)", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockConnectChild.mockResolvedValue({
      connected: true,
      child_uuid: "ac-1",
      display_name: "Pip",
      player_id: "child-1",
      created_account: false,
    });

    const response = await POST(req("POST"), ctx);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.enabled).toBe(true);
    expect(mockConnectChild).toHaveBeenCalledWith(
      expect.objectContaining({ email: "parent@example.com", playerId: "child-1", childEmail: "pip@example.com" }),
    );
    expect(mockSaveChildLink).toHaveBeenCalledWith(
      "fam-1",
      "child-1",
      expect.objectContaining({ childUuid: "ac-1" }),
    );
  });

  it("returns 409 with the children list when selection is needed", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockConnectChild.mockRejectedValue(
      new AthenaIntegrationError("needs_selection", "pick", 409, "ATHENA_HTTP_409", [
        { childUuid: "ac-1", displayName: "Existing Kid", email: null, linkedPlayerId: null },
      ]),
    );

    const response = await POST(req("POST"), ctx);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.needsSelection).toBe(true);
    expect(body.athenaChildren).toHaveLength(1);
    expect(mockSaveChildLink).not.toHaveBeenCalled();
  });

  it("passes an explicit childUuid selection through", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockConnectChild.mockResolvedValue({
      connected: true,
      child_uuid: "ac-9",
      display_name: "Pip",
      player_id: "child-1",
      created_account: false,
    });

    const response = await POST(req("POST", { childUuid: "ac-9" }), ctx);
    expect(response.status).toBe(201);
    expect(mockConnectChild).toHaveBeenCalledWith(expect.objectContaining({ childUuid: "ac-9" }));
  });

  it("rejects when the family hasn't connected Athena (400)", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockGetConnection.mockResolvedValue({ connected: false });

    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(400);
    expect(mockConnectChild).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin", async () => {
    mockGetSession.mockReturnValue({ uid: "kid", role: "player", email: "k@example.com" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(403);
    expect(mockConnectChild).not.toHaveBeenCalled();
  });

  it("404s when the target member isn't a player", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockAdminGetDocument.mockResolvedValue(memberDoc("admin", "Parent", "p@example.com"));
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(404);
  });
});

describe("DELETE .../athena/children/[playerId] (disable)", () => {
  it("disconnects remotely and clears local state", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockDisconnectChild.mockResolvedValue({ success: true, disconnected: true });

    const response = await DELETE(req("DELETE"), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(mockDisconnectChild).toHaveBeenCalledWith({ email: "parent@example.com", playerId: "child-1" });
    expect(mockDeleteChildLink).toHaveBeenCalledWith("fam-1", "child-1");
  });

  it("still clears local state if the remote disconnect fails", async () => {
    mockGetSession.mockReturnValue(ADMIN);
    mockDisconnectChild.mockRejectedValue(new AthenaIntegrationError("upstream_error", "down", 502, "x"));

    const response = await DELETE(req("DELETE"), ctx);
    expect(response.status).toBe(200);
    expect(mockDeleteChildLink).toHaveBeenCalledWith("fam-1", "child-1");
  });
});
