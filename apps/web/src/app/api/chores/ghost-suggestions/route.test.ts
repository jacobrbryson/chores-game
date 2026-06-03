import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionFromRequest,
  mockResolveContext,
  mockGetSuggestions,
  mockRequest,
  mockDismiss,
  mockNotify,
  mockListRequested,
  mockApprove,
  mockReject,
  mockAdd,
} = vi.hoisted(() => ({
  mockGetSessionFromRequest: vi.fn(),
  mockResolveContext: vi.fn(),
  mockGetSuggestions: vi.fn(),
  mockRequest: vi.fn(),
  mockDismiss: vi.fn(),
  mockNotify: vi.fn(),
  mockListRequested: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  mockAdd: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));
vi.mock("@/lib/ghost-chores-service", () => ({
  resolveGhostViewerContext: mockResolveContext,
  getGhostSuggestionsForViewer: mockGetSuggestions,
  requestGhostSuggestion: mockRequest,
  dismissGhostSuggestion: mockDismiss,
  notifyGhostRequest: mockNotify,
  listRequestedGhostSuggestions: mockListRequested,
  approveGhostSuggestion: mockApprove,
  rejectGhostSuggestion: mockReject,
  addGhostSuggestion: mockAdd,
}));

import { GET } from "@/app/api/chores/ghost-suggestions/route";
import { POST as REQUEST_POST } from "@/app/api/chores/ghost-suggestions/[suggestionId]/request/route";
import { GET as REQUESTS_GET } from "@/app/api/chores/ghost-suggestions/requests/route";
import { POST as APPROVE_POST } from "@/app/api/chores/ghost-suggestions/[suggestionId]/approve/route";
import { POST as ADD_POST } from "@/app/api/chores/ghost-suggestions/[suggestionId]/add/route";

function makeRequest(body: unknown = {}) {
  return { json: async () => body, nextUrl: { searchParams: new URLSearchParams() } } as never;
}

const playerSession = { uid: "uid-player", memberId: "member-player", email: "p@x.com", name: "Player", role: "player" };
const adminSession = { uid: "uid-admin", memberId: "member-admin", email: "a@x.com", name: "Admin", role: "admin" };

const playerContext = {
  familyId: "family-1",
  memberId: "member-player",
  role: "player",
  aliases: ["uid-player"],
  openChoreCount: 0,
  openChoreKeys: new Set<string>(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chores/ghost-suggestions", () => {
  it("rejects unauthenticated users", async () => {
    mockGetSessionFromRequest.mockReturnValue(null);
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it("returns empty + ineligible when there is no active family", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(null);
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.eligible).toBe(false);
    expect(body.suggestions).toEqual([]);
  });

  it("returns suggestions when the player has no open chores", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    mockGetSuggestions.mockResolvedValue({
      suggestions: [{ id: "builtin_template__make-your-bed", suggestedTitle: "Make your bed" }],
      hasOpenChores: false,
    });
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.suggestions).toHaveLength(1);
    expect(body.eligible).toBe(true);
  });
});

describe("POST request/dismiss player actions", () => {
  it("blocks a duplicate request with 409", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    mockRequest.mockResolvedValue({ ok: false, error: "duplicate_request" });
    const response = await REQUEST_POST(makeRequest(), { params: Promise.resolve({ suggestionId: "s1" }) });
    expect(response.status).toBe(409);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("requests a suggestion and notifies admins", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    mockRequest.mockResolvedValue({ ok: true, record: { status: "requested", suggestedTitle: "Make your bed" } });
    const response = await REQUEST_POST(makeRequest(), { params: Promise.resolve({ suggestionId: "s1" }) });
    expect(response.status).toBe(201);
    expect(mockNotify).toHaveBeenCalledOnce();
  });
});

describe("admin review permissions", () => {
  it("forbids players from listing ghost requests", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    const response = await REQUESTS_GET(makeRequest());
    expect(response.status).toBe(403);
  });

  it("forbids players from approving", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    const response = await APPROVE_POST(makeRequest(), { params: Promise.resolve({ suggestionId: "s1" }) });
    expect(response.status).toBe(403);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("lets a player add a suggestion directly (creates a chore, upvotes)", async () => {
    mockGetSessionFromRequest.mockReturnValue(playerSession);
    mockResolveContext.mockResolvedValue(playerContext);
    mockAdd.mockResolvedValue({ ok: true, choreId: "chore-see-do" });
    const response = await ADD_POST(makeRequest({ assigneeId: "member-player" }), {
      params: Promise.resolve({ suggestionId: "s1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.choreId).toBe("chore-see-do");
    expect(mockAdd).toHaveBeenCalledOnce();
  });

  it("lets an admin approve, creating a real chore", async () => {
    mockGetSessionFromRequest.mockReturnValue(adminSession);
    mockResolveContext.mockResolvedValue({ ...playerContext, role: "admin", memberId: "member-admin" });
    mockApprove.mockResolvedValue({ ok: true, choreId: "chore-9" });
    const response = await APPROVE_POST(makeRequest({ coinValue: 10 }), {
      params: Promise.resolve({ suggestionId: "s1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.choreId).toBe("chore-9");
    expect(mockApprove).toHaveBeenCalledOnce();
  });
});
