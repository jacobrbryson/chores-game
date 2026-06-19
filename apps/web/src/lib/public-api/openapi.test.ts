import { describe, expect, it } from "vitest";
import { buildPublicApiOpenApiSpec } from "@/lib/public-api/openapi";

describe("public API OpenAPI spec", () => {
  it("documents bearer auth, rate limit headers, and required endpoints", () => {
    const spec = buildPublicApiOpenApiSpec("https://example.test") as {
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<string, { get?: { responses: Record<string, { headers?: Record<string, unknown> }> } }>;
    };

    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
    for (const path of [
      "/api/v1/me",
      "/api/v1/players",
      "/api/v1/players/{playerId}/coins",
      "/api/v1/players/{playerId}/chores",
      "/api/v1/players/{playerId}/chores/today",
      "/api/v1/players/{playerId}/achievements/recent",
    ]) {
      expect(spec.paths[path]?.get).toBeTruthy();
      expect(spec.paths[path]?.get?.responses[200].headers?.["X-RateLimit-Limit"]).toBeTruthy();
      expect(spec.paths[path]?.get?.responses[429]).toBeTruthy();
    }
  });
});
