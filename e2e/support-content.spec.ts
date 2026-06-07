import { loginAsSupport } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { uniqueTitle } from "./helpers/workflows";

test.describe("support content workflow", () => {
  test.skip(!hasE2ECredentials("support"), e2eSkipReason("support"));

  test("support creates and publishes a guide", async ({ page }) => {
    const title = uniqueTitle("E2E support guide");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    await loginAsSupport(page);
    await page.goto("/support/content");
    await expect(page.getByRole("heading", { name: /content/i })).toBeVisible();

    await page.getByRole("button", { name: /^create$/i }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Short description").fill("A short Playwright-created guide for the SEO pipeline.");
    await page.getByLabel("Category").fill("testing");
    await page.getByLabel("Tags").fill("testing, e2e");
    await page.getByLabel("Age range").fill("all ages");
    await page.getByLabel("Difficulty").fill("easy");
    await page.getByLabel("Estimated minutes").fill("5");
    await page.getByLabel("Image").fill("/store/theme.png");
    await page.getByLabel("SEO title").fill(title);
    await page.getByLabel("SEO description").fill("Playwright validates that support can publish curated content.");
    await page.getByLabel("Open Graph image").fill("/store/theme.png");
    await page.getByLabel("Body").fill("This is a concise guide created by the E2E suite.");
    await page.getByRole("button", { name: /^save$/i }).click();

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toContainText("draft");
    await row.getByRole("button", { name: /^review$/i }).click();
    await expect(row).toContainText("review");
    await row.getByRole("button", { name: /^approve$/i }).click();
    await expect(row).toContainText("approved");
    await row.getByRole("button", { name: /^publish$/i }).click();
    await expect(row).toContainText("published");

    await page.goto(`/resources/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
