import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("retired quest surface", () => {
  it.each([
    "/quests",
    "/quests/example",
    "/family/quests",
    "/family/quests/example",
    "/features/quests",
  ])("returns 404 for the retired page %s", (path) => {
    const response = middleware(new NextRequest(`http://localhost:3000${path}`));
    expect(response.status).toBe(404);
  });

  it.each([
    "/api/quests",
    "/api/quests/example/start",
    "/api/family/quests",
    "/api/v1/quests",
    "/api/v1/quests/example/choice",
  ])("returns 404 for the retired API %s", (path) => {
    const response = middleware(new NextRequest(`http://localhost:3000${path}`, { method: "POST" }));
    expect(response.status).toBe(404);
  });
});
