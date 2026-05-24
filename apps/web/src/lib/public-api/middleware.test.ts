import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { withPublicApiHeaders } from "@/lib/public-api/middleware";

describe("public API middleware helpers", () => {
  it("adds request id and rate limit headers", () => {
    const response = withPublicApiHeaders(NextResponse.json({ ok: true }), "req-1", {
      limit: 1000,
      used: 12,
      remaining: 988,
      resetAt: "2026-05-24T00:00:00.000Z",
    });

    expect(response.headers.get("X-Request-Id")).toBe("req-1");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("1000");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("988");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("2026-05-24T00:00:00.000Z");
    expect(response.headers.get("X-RateLimit-Used")).toBe("12");
  });
});
