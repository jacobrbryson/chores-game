import { loginAsParent } from "./helpers/auth";
import { E2E_TEST_DATA, e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { expectChoreVisible, uniqueTitle } from "./helpers/workflows";

test.describe("parent chore workflow", () => {
  test.skip(!hasE2ECredentials("parent"), e2eSkipReason("parent"));

  test("parent creates a chore assigned to the child", async ({ page }) => {
    const title = uniqueTitle("E2E parent chore");

    await loginAsParent(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^add chore$/i }).click();
    await page.getByLabel(/description/i).fill(title);
    await page.getByLabel(/assignee/i).click();
    await page.getByRole("option", { name: E2E_TEST_DATA.child.name }).click();
    await page.getByLabel(/coin value/i).fill("7");
    await page.getByRole("button", { name: /^add chore$/i }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await page.goto("/chores");
    await expectChoreVisible(page, title);
  });
});
