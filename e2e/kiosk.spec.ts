import { loginAsChild, loginAsParent } from "./helpers/auth";
import { E2E_TEST_DATA, e2eSkipReason, hasE2ECredentials } from "./helpers/env";
import { expect, test } from "./helpers/test";
import { createChore, expectChoreVisible, uniqueTitle } from "./helpers/workflows";
import {
  enterKioskViaDialog,
  getMemberCoins,
  startKiosk,
  stopKiosk,
} from "./helpers/kiosk";

const KIOSK_BADGE = "Kiosk Mode";

test.describe("Family Kiosk Mode", () => {
  test.skip(!hasE2ECredentials("parent", "child"), e2eSkipReason("parent", "child"));

  const child = E2E_TEST_DATA.child;
  const childTwo = E2E_TEST_DATA.childTwo;
  const parent = E2E_TEST_DATA.parent;

  test("parent enters Kiosk Mode from the Switch To dialog and sees the player's checklist", async ({ page }) => {
    const title = uniqueTitle("E2E kiosk dialog");

    await loginAsParent(page);
    await createChore(page.request, { title, assigneeId: child.memberId, requireApproval: false });

    await page.goto("/");
    await enterKioskViaDialog(page, child.name);

    // Kiosk chrome is active and the selected player's chore is shown.
    await expect(page.getByText(KIOSK_BADGE, { exact: true })).toBeVisible();
    await expectChoreVisible(page, title);
    // No global app navigation is exposed in kiosk mode.
    await expect(page.getByRole("button", { name: "Open profile menu" })).toHaveCount(0);
  });

  test("shows only the active player's chores and switches between roster players in place", async ({ page }) => {
    const titleOne = uniqueTitle("E2E kiosk childA");
    const titleTwo = uniqueTitle("E2E kiosk childB");

    await loginAsParent(page);
    await createChore(page.request, { title: titleOne, assigneeId: child.memberId, requireApproval: false });
    await createChore(page.request, { title: titleTwo, assigneeId: childTwo.memberId, requireApproval: false });

    await startKiosk(page.request, [child.memberId, childTwo.memberId]);
    await page.goto("/kiosk");

    // Active player is the first of the roster (child A): only their chore shows.
    await expectChoreVisible(page, titleOne);
    await expect(page.getByText(titleTwo, { exact: false })).toHaveCount(0);

    // Switch to child B via the roster card (in-place, no full reload).
    await page
      .locator(".kiosk-roster-card")
      .filter({ has: page.getByText(childTwo.name, { exact: true }) })
      .click();

    await expectChoreVisible(page, titleTwo);
    await expect(page.getByText(titleOne, { exact: false })).toHaveCount(0);
  });

  test("completing a chore credits the selected player, not the authenticated parent", async ({ page }) => {
    const title = uniqueTitle("E2E kiosk payout");
    const coinValue = 5;

    await loginAsParent(page);
    const childBefore = await getMemberCoins(page.request, child.memberId);
    const parentBefore = await getMemberCoins(page.request, parent.memberId);
    await createChore(page.request, {
      title,
      assigneeId: child.memberId,
      coinValue,
      requireApproval: false,
    });

    await startKiosk(page.request, [child.memberId]);
    await page.goto("/kiosk");
    await expectChoreVisible(page, title);
    await page
      .locator(".kiosk-chore-card")
      .filter({ has: page.getByText(title, { exact: false }) })
      .getByRole("button", { name: "Done" })
      .click();
    // The completed chore leaves the list.
    await expect(page.getByText(title, { exact: false })).toHaveCount(0);

    await stopKiosk(page.request);

    const childAfter = await getMemberCoins(page.request, child.memberId);
    const parentAfter = await getMemberCoins(page.request, parent.memberId);
    expect(childAfter).toBe(childBefore + coinValue);
    expect(parentAfter).toBe(parentBefore);
  });

  test("locks navigation to /kiosk and blocks parent/admin actions server-side", async ({ page }) => {
    const title = uniqueTitle("E2E kiosk guard");

    await loginAsParent(page);
    const choreId = await createChore(page.request, {
      title,
      assigneeId: child.memberId,
      requireApproval: true,
    });

    await startKiosk(page.request, [child.memberId]);

    // Middleware lock: any other page route redirects back to /kiosk.
    await page.goto("/chores");
    await expect(page).toHaveURL(/\/kiosk(\?|\/|$)/);

    // Server-side permission enforcement (the active identity is a player):
    // approving a chore is admin-only and must be rejected.
    const approveResponse = await page.request.patch(`/api/chores/${choreId}`, {
      data: { action: "approve" },
    });
    expect(approveResponse.status()).toBe(403);

    // An admin-only family endpoint must also be forbidden while in kiosk.
    const privacyResponse = await page.request.get("/api/family/privacy");
    expect(privacyResponse.ok()).toBeFalsy();
    expect(privacyResponse.status()).toBe(403);
  });

  test("a player can enter Kiosk Mode", async ({ page }) => {
    await loginAsChild(page);
    await startKiosk(page.request, [child.memberId]);
    await page.goto("/kiosk");
    await expect(page.getByText(KIOSK_BADGE, { exact: true })).toBeVisible();
  });

  test("exiting Kiosk Mode returns to the authenticated parent with full app access", async ({ page }) => {
    await loginAsParent(page);
    await startKiosk(page.request, [child.memberId]);

    // Locked while active...
    await page.goto("/");
    await expect(page).toHaveURL(/\/kiosk(\?|\/|$)/);

    await stopKiosk(page.request);

    // ...and the full app is reachable again after exit.
    await page.goto("/chores");
    await expect(page).toHaveURL(/\/chores(\?|\/|$)/);
    await expect(page.getByRole("heading", { name: /chores/i })).toBeVisible();
  });
});
