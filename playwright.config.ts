import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

process.env.SESSION_SECRET ??= "playwright-local-session-secret-32-chars-minimum";
process.env.SUPPORT_ADMIN_EMAILS = [
  process.env.SUPPORT_ADMIN_EMAILS,
  process.env.E2E_SUPPORT_EMAIL ?? "support.test@family-chores.test",
]
  .filter(Boolean)
  .join(",");

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    headless: process.env.CI ? true : process.env.PLAYWRIGHT_HEADLESS !== "false",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `npm run dev:web -- --hostname 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          SESSION_SECRET: process.env.SESSION_SECRET,
          SUPPORT_ADMIN_EMAILS: process.env.SUPPORT_ADMIN_EMAILS,
        },
      },
});
