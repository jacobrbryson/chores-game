import { loginAsChild, loginAsParent } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { openFamilyPrivacy } from "./helpers/workflows";

test.describe("family privacy workflow", () => {
  test.skip(!hasE2ECredentials("parent", "child"), e2eSkipReason("parent", "child"));

  test("parent can request a family export", async ({ page }) => {
    await loginAsParent(page);
    await openFamilyPrivacy(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /download family data/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/family-data.*\.json$/);
    await expect(page.getByRole("status").getByText(/export/i)).toBeVisible();
  });

  test("child cannot access family privacy controls", async ({ page }) => {
    await loginAsChild(page);
    await page.goto("/family");

    await expect(page.getByRole("button", { name: /privacy/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /privacy overview/i })).toHaveCount(0);
  });
});
