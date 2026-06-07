import type { Page, Route } from "@playwright/test";
import { loginAsChild, loginAsParent } from "./helpers/auth";
import { expect, test } from "./helpers/test";

// ---------------------------------------------------------------------------
// Mock helpers — all Firestore-touching routes are intercepted so these tests
// run without real credentials and leave no state in the database.
// ---------------------------------------------------------------------------

type OnboardingStatusOverride = {
  viewerRole?: "admin" | "player";
  needsOnboarding?: boolean;
  needsReacceptance?: boolean;
  currentTermsVersion?: string;
  currentPrivacyVersion?: string;
};

function mockOnboardingStatus(page: Page, override: OnboardingStatusOverride = {}) {
  return page.route("**/api/family/onboarding-status", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        viewerRole: "admin",
        needsOnboarding: true,
        needsReacceptance: false,
        currentTermsVersion: "2026-06-06",
        currentPrivacyVersion: "2026-06-06",
        ...override,
      }),
    }),
  );
}

function mockOnboardingComplete(page: Page) {
  return page.route("**/api/onboarding/complete", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }),
  );
}

function mockPrivacyConsent(page: Page) {
  return page.route("**/api/family/privacy/consent", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }),
  );
}

function mockAddMember(page: Page) {
  return page.route("**/api/family/members", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }),
  );
}

function mockCreateChore(page: Page) {
  return page.route("**/api/chores", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, createdChoreIds: ["test-chore-e2e"] }),
    }),
  );
}

// Set up all write-path mocks so individual tests only override what they need.
async function setupOnboardingMocks(page: Page, statusOverride: OnboardingStatusOverride = {}) {
  await mockOnboardingStatus(page, statusOverride);
  await mockOnboardingComplete(page);
  await mockPrivacyConsent(page);
  await mockAddMember(page);
  await mockCreateChore(page);
}

// ---------------------------------------------------------------------------
// Wizard navigation helpers — match the actual locale strings from en-US.json
// ---------------------------------------------------------------------------

async function advanceWelcome(page: Page) {
  await expect(page.getByRole("heading", { name: "Welcome to Family Chores" })).toBeVisible();
  await page.getByRole("button", { name: "Get Started" }).click();
}

async function advanceFamily(page: Page, name = "Playwright Family") {
  await expect(page.getByRole("heading", { name: "Name Your Family" })).toBeVisible();
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function advancePrivacy(page: Page) {
  await expect(page.getByRole("heading", { name: "Your Family's Privacy" })).toBeVisible();
  const checkboxes = page.getByRole("checkbox");
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    await checkboxes.nth(i).check();
  }
  await page.getByRole("button", { name: "Continue" }).click();
}

async function skipAddChild(page: Page) {
  await expect(page.getByRole("heading", { name: "Add Your First Child" })).toBeVisible();
  await page.getByRole("button", { name: "Skip For Now" }).click();
}

async function addChild(page: Page, childName = "Little One") {
  await expect(page.getByRole("heading", { name: "Add Your First Child" })).toBeVisible();
  await page.getByRole("textbox").fill(childName);
  await page.getByRole("button", { name: "Add Child" }).click();
  // After adding, a "Continue" button appears to advance to next step
  await page.getByRole("button", { name: "Continue" }).first().click();
}

async function skipFirstChore(page: Page) {
  await expect(page.getByRole("heading", { name: "Create Your First Chore" })).toBeVisible();
  await page.getByRole("button", { name: "Skip For Now" }).click();
}

async function addFirstChore(page: Page, title = "Make Bed") {
  await expect(page.getByRole("heading", { name: "Create Your First Chore" })).toBeVisible();
  await page.getByRole("textbox", { name: "Chore Title" }).fill(title);
  await page.getByRole("button", { name: "Create Chore" }).click();
  // After creating, success screen shows "Continue" to advance
  await expect(page.getByRole("heading", { name: "Chore Created!" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("onboarding wizard", () => {
  test("brand new parent completes full onboarding", async ({ page }) => {
    await loginAsParent(page);
    await setupOnboardingMocks(page);

    await page.goto("/onboarding");

    await advanceWelcome(page);
    await advanceFamily(page, "E2E Family");
    await advancePrivacy(page);
    await addChild(page, "E2E Child");
    await addFirstChore(page, "Clean Room");

    // Done step — success screen and dashboard button visible
    await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible();
    await page.getByRole("button", { name: "Go to Dashboard" }).click();
    await expect(page).not.toHaveURL(/\/onboarding/);
  });

  test("parent skips child creation", async ({ page }) => {
    await loginAsParent(page);
    await setupOnboardingMocks(page);

    await page.goto("/onboarding");

    await advanceWelcome(page);
    await advanceFamily(page);
    await advancePrivacy(page);
    await skipAddChild(page);

    // Should advance to the first chore step
    await expect(page.getByRole("heading", { name: "Create Your First Chore" })).toBeVisible();
    await skipFirstChore(page);

    await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible();
  });

  test("parent skips first chore", async ({ page }) => {
    await loginAsParent(page);
    await setupOnboardingMocks(page);

    await page.goto("/onboarding");

    await advanceWelcome(page);
    await advanceFamily(page);
    await advancePrivacy(page);
    await addChild(page, "My Kid");
    await skipFirstChore(page);

    await expect(page.getByRole("heading", { name: "You're all set!" })).toBeVisible();
  });

  test("consent step requires all checkboxes before Continue is enabled", async ({ page }) => {
    await loginAsParent(page);
    await setupOnboardingMocks(page);

    await page.goto("/onboarding");

    await advanceWelcome(page);
    await advanceFamily(page);

    // Privacy step — Continue must be disabled before any checkbox is checked
    await expect(page.getByRole("heading", { name: "Your Family's Privacy" })).toBeVisible();
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeDisabled();

    const checkboxes = page.getByRole("checkbox");
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Each intermediate state keeps the button disabled
    for (let i = 0; i < count - 1; i++) {
      await checkboxes.nth(i).check();
      await expect(continueBtn).toBeDisabled();
    }
    // Final checkbox enables Continue
    await checkboxes.nth(count - 1).check();
    await expect(continueBtn).toBeEnabled();
  });

  test("existing user is redirected away from /onboarding", async ({ page }) => {
    await loginAsParent(page);
    // Family has already completed onboarding — no gate needed
    await mockOnboardingStatus(page, { needsOnboarding: false, needsReacceptance: false });

    await page.goto("/onboarding");

    // Wizard detects onboarding is not needed and redirects to home
    await expect(page).not.toHaveURL(/\/onboarding/);
  });

  test("version mismatch shows blocking re-acceptance modal on dashboard", async ({ page }) => {
    await loginAsParent(page);
    await mockOnboardingStatus(page, {
      needsOnboarding: false,
      needsReacceptance: true,
      currentTermsVersion: "2026-06-06",
      currentPrivacyVersion: "2026-06-06",
    });
    await mockPrivacyConsent(page);

    await page.goto("/");

    // Re-acceptance modal must be visible
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(3);

    // Escape must not dismiss the blocking modal
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Accept all checkboxes and submit
    const checkboxes = page.getByRole("dialog").getByRole("checkbox");
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await page.getByRole("dialog").getByRole("button", { name: /agree|accept|confirm/i }).click();

    // Modal closes after acceptance
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("consent POST is sent exactly once with correct payload when privacy step is submitted", async ({
    page,
  }) => {
    await loginAsParent(page);
    await mockOnboardingStatus(page);
    await mockOnboardingComplete(page);
    await mockAddMember(page);
    await mockCreateChore(page);

    const consentRequests: Array<Record<string, unknown>> = [];
    // Override the consent route to record the request body before fulfilling
    await page.route("**/api/family/privacy/consent", async (route: Route) => {
      const body = (await route.request().postDataJSON().catch(() => null)) as Record<
        string,
        unknown
      >;
      consentRequests.push(body ?? {});
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/onboarding");

    await advanceWelcome(page);
    await advanceFamily(page);
    await advancePrivacy(page);

    // Exactly one consent request must have been made
    expect(consentRequests).toHaveLength(1);
    // The wizard posts { dataRegion: "US" } — the server records the consent events
    expect(consentRequests[0]).toMatchObject({ dataRegion: "US" });
  });

  test("child user is redirected away from /onboarding", async ({ page }) => {
    await loginAsChild(page);
    // Players always get needsOnboarding: false from the API
    await mockOnboardingStatus(page, {
      viewerRole: "player",
      needsOnboarding: false,
      needsReacceptance: false,
    });

    await page.goto("/onboarding");

    // Wizard detects non-admin viewer and redirects away immediately
    await expect(page).not.toHaveURL(/\/onboarding/);
  });
});
