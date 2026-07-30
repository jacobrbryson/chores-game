import { loginAsParent } from "./helpers/auth";
import { E2E_TEST_DATA, e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { createChore, expectChoreVisible, uniqueTitle } from "./helpers/workflows";

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

  test("parent sees the completion celebration after approving a shared chore", async ({ page }) => {
    const title = uniqueTitle("E2E shared chore celebration");

    await loginAsParent(page);
    await createChore(page.request, {
      title,
      assigneeIds: [
        E2E_TEST_DATA.child.memberId,
        E2E_TEST_DATA.childTwo.memberId,
      ],
      assigneeScope: "multiple",
      coinValue: 8,
      requireApproval: false,
    });

    await page.goto("/");
    const choreRow = page.locator(".today-chore-item").filter({ hasText: title });
    await expect(choreRow).toBeVisible();
    await choreRow.getByRole("button", { name: /mark as complete/i }).click();
    await expect(
      page.getByRole("heading", { name: /complete and approve chore/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^complete and approve$/i }).click();

    await expect(page.getByText("All Done!", { exact: true })).toBeVisible();
  });
});
