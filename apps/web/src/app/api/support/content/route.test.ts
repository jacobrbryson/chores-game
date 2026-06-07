import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  isSupportAdmin: vi.fn(),
  createPublicContent: vi.fn(),
  listPublicContentRecords: vi.fn(),
  getSeoIssues: vi.fn(),
  summarizeSeo: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock("@/lib/support/access", () => ({ isSupportAdmin: mocks.isSupportAdmin }));
vi.mock("@/lib/public-content/service", () => ({
  createPublicContent: mocks.createPublicContent,
  listPublicContentRecords: mocks.listPublicContentRecords,
  getSeoIssues: mocks.getSeoIssues,
  summarizeSeo: mocks.summarizeSeo,
}));

import { GET, POST } from "./route";

const session = { uid: "support-1", email: "support@example.com", name: "Support" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionFromRequest.mockReturnValue(session);
  mocks.isSupportAdmin.mockReturnValue(true);
  mocks.listPublicContentRecords.mockResolvedValue({
    records: [],
    allRecords: [],
    pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1, hasMore: false },
  });
  mocks.summarizeSeo.mockReturnValue({ total: 0 });
  mocks.getSeoIssues.mockReturnValue([]);
});

describe("/api/support/content", () => {
  it("blocks non-support users", async () => {
    mocks.isSupportAdmin.mockReturnValue(false);
    const response = await GET(new NextRequest("http://localhost/api/support/content"));
    expect(response.status).toBe(403);
  });

  it("lists content for support admins", async () => {
    const response = await GET(new NextRequest("http://localhost/api/support/content?type=guide"));
    expect(response.status).toBe(200);
    expect(mocks.listPublicContentRecords).toHaveBeenCalledWith(expect.objectContaining({ type: "guide" }));
  });

  it("lets support admins create content", async () => {
    mocks.createPublicContent.mockResolvedValue({ ok: true, record: { id: "content-1" } });
    const response = await POST(
      new NextRequest("http://localhost/api/support/content", {
        method: "POST",
        body: JSON.stringify({ type: "guide", title: "Guide", slug: "guide" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createPublicContent).toHaveBeenCalledWith(expect.objectContaining({ title: "Guide" }), session);
  });

  it("returns validation errors from the service", async () => {
    mocks.createPublicContent.mockResolvedValue({ ok: false, error: "slug_invalid" });
    const response = await POST(
      new NextRequest("http://localhost/api/support/content", {
        method: "POST",
        body: JSON.stringify({ type: "guide", title: "Guide", slug: "../bad" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "slug_invalid" });
  });
});
