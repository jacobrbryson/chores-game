import { describe, expect, it } from "vitest";
import { resolveInternalProxyUrl } from "./response";

describe("resolveInternalProxyUrl", () => {
  it("uses loopback HTTP with the runtime port in Cloud Run", () => {
    const url = resolveInternalProxyUrl(
      "https://api.example.com:8080/api/v1/families/current",
      "/api/family/summary",
      "8080",
    );

    expect(url.toString()).toBe("http://127.0.0.1:8080/api/family/summary");
  });

  it("preserves the request origin when no runtime port is available", () => {
    const url = resolveInternalProxyUrl(
      "http://localhost:3000/api/v1/families/current",
      "/api/family/summary",
      undefined,
    );

    expect(url.toString()).toBe("http://localhost:3000/api/family/summary");
  });

  it("ignores invalid runtime ports", () => {
    const url = resolveInternalProxyUrl(
      "https://family-chores.app/api/v1/families/current",
      "/api/family/summary",
      "not-a-port",
    );

    expect(url.toString()).toBe("https://family-chores.app/api/family/summary");
  });
});
