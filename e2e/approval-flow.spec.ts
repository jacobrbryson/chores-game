import { loginAsChild, loginAsParent } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { completeChore, createChore, expectChoreVisible, openChoresPage, uniqueTitle } from "./helpers/workflows";

test.describe("parent approval workflow", () => {
  test.skip(!hasE2ECredentials("parent", "child"), e2eSkipReason("parent", "child"));

  test("parent approves a submitted chore and awards coins", async ({ page }) => {
    const title = uniqueTitle("E2E approval chore");

    await loginAsParent(page);
    const choreId = await createChore(page.request, { title, coinValue: 9, requireApproval: true });

    await loginAsChild(page);
    await completeChore(page.request, choreId);

    await loginAsParent(page);
    await openChoresPage(page);
    await expectChoreVisible(page, title);
    await page.getByRole("button", { name: /^approve$/i }).first().click();
    await expect(page.getByRole("heading", { name: /approve chore/i })).toBeVisible();
    await page.getByRole("button", { name: /^approve$/i }).last().click();

    await expect(page.getByText(/approved/i).first()).toBeVisible();
    await expect(page.getByText("9").first()).toBeVisible();
  });
});
