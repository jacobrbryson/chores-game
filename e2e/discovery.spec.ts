import { loginAsParent } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { createChore, uniqueTitle } from "./helpers/workflows";
import type { APIRequestContext } from "@playwright/test";

type DiscoverySummary = {
  sections?: Record<string, { count?: number }>;
  totalCount?: number;
};

async function choreDiscoveryCount(request: APIRequestContext) {
  const response = await request.get("/api/discovery/summary?sections=chores");
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as DiscoverySummary;
  return payload.sections?.chores?.count ?? 0;
}

test.describe("discovery workflow", () => {
  test.skip(!hasE2ECredentials("parent"), e2eSkipReason("parent"));

  test("new chore badge appears and clears when chores are viewed", async ({ page }) => {
    await loginAsParent(page);

    await page.request.post("/api/discovery/seen", { data: { sections: ["chores"] } });
    const before = await choreDiscoveryCount(page.request);

    await createChore(page.request, { title: uniqueTitle("E2E discovery chore"), coinValue: 4 });
    await expect.poll(() => choreDiscoveryCount(page.request)).toBeGreaterThan(before);

    await page.goto("/chores");
    await expect(page.getByRole("heading", { name: /chores/i })).toBeVisible();
    await expect.poll(() => choreDiscoveryCount(page.request)).toBe(0);
  });
});
