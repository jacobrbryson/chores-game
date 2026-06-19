import { loginAsChild, loginAsSupport } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";

test.describe("support operations dashboard", () => {
  test.skip(!hasE2ECredentials("support"), e2eSkipReason("support"));

  test("support can open the Operations tab and see the dashboard", async ({ page }) => {
    await loginAsSupport(page);
    await page.goto("/support/operations");

    // Tab is reachable and the header renders.
    await expect(page.getByRole("heading", { name: /operations/i })).toBeVisible();

    // Health/observability cards render.
    await expect(page.getByText(/system health/i)).toBeVisible();
    await expect(page.getByText(/pagination risks/i).first()).toBeVisible();

    // Core tables render their headers.
    await expect(page.getByRole("heading", { name: /slow operations/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /recent errors/i })).toBeVisible();

    // Filters + refresh are present.
    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
  });

  test("the metrics API rejects non-support users", async ({ page }) => {
    // Children must not be able to read operation metrics, even via direct API call.
    await loginAsChild(page);
    const response = await page.request.get("/api/support/operations");
    expect(response.status()).toBe(403);
  });
});
