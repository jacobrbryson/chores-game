import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProxyJson = vi.fn();

vi.mock("@/app/api/v1/_lib/response", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/v1/_lib/response")>(
    "@/app/api/v1/_lib/response",
  );
  return { ...actual, proxyJson: mockProxyJson };
});

function v1Request(query = "") {
  return new NextRequest(`http://localhost/api/v1/feed${query}`);
}

describe("GET /api/v1/feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProxyJson.mockResolvedValue({ status: 200, json: { items: [], pagination: {} } });
  });

  it("forwards paging, scope, and the device timezone offset", async () => {
    const { GET } = await import("./route");
    await GET(v1Request("?page=2&limit=10&scope=friends&tzOffsetMinutes=300"));
    const [, path] = mockProxyJson.mock.calls[0];
    const forwarded = new URL(path, "http://localhost").searchParams;
    expect(forwarded.get("page")).toBe("2");
    expect(forwarded.get("limit")).toBe("10");
    expect(forwarded.get("scope")).toBe("friends");
    // Without the offset the feed would group daily roll-ups by UTC, splitting
    // an evening across two days for anyone west of it.
    expect(forwarded.get("tzOffsetMinutes")).toBe("300");
  });

  it("proxies without a query string when the client sends no params", async () => {
    const { GET } = await import("./route");
    await GET(v1Request());
    expect(mockProxyJson.mock.calls[0][1]).toBe("/api/feed");
  });

  it("surfaces upstream failures", async () => {
    mockProxyJson.mockResolvedValue({ status: 401, json: { error: "reauth_required" } });
    const { GET } = await import("./route");
    const response = await GET(v1Request());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "reauth_required" } });
  });
});
