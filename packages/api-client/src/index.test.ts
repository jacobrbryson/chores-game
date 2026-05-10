import { describe, expect, it } from "vitest";
import { createApiClient } from "./index";

describe("api client", () => {
  it("builds URLs from baseUrl", async () => {
    const calls: string[] = [];
    const client = createApiClient({
      baseUrl: "http://localhost:3000/api/v1",
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ ok: true, data: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } } }), { status: 200 });
      }) as typeof fetch,
    });

    await client.chores.list();
    expect(calls[0]).toBe("http://localhost:3000/api/v1/chores");
  });
});
