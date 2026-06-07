import { loginAsChild, loginAsParent } from "./helpers/auth";
import { e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { createChore, expectChoreVisible, uniqueTitle } from "./helpers/workflows";

test.describe("child chore workflow", () => {
  test.skip(!hasE2ECredentials("parent", "child"), e2eSkipReason("parent", "child"));

  test("child completes an assigned chore", async ({ page }) => {
    const title = uniqueTitle("E2E child chore");

    await loginAsParent(page);
    await createChore(page.request, { title, coinValue: 5, requireApproval: true });

    await loginAsChild(page);
    await page.goto("/");
    await expectChoreVisible(page, title);
    await page.getByRole("button", { name: /mark as complete/i }).click();

    await page.goto("/chores?status=completed");
    await expectChoreVisible(page, title);
    await expect(page.getByText(/completed|submitted/i).first()).toBeVisible();
  });
});
