import { test as base } from "@playwright/test";
import { monitorConsoleErrors } from "./console";

export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleMonitor = monitorConsoleErrors(page);
    await use(page);
    consoleMonitor.assertNoErrors();
  },
});

export { expect } from "@playwright/test";
