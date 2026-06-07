import type { Page } from "@playwright/test";

const IGNORED_CONSOLE_ERRORS: RegExp[] = [
  // Add intentionally accepted browser-only errors here with a short comment.
];

export function monitorConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (!IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) {
      errors.push(`console.error: ${text}`);
    }
  });

  page.on("pageerror", (error) => {
    const text = error.message;
    if (!IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) {
      errors.push(`pageerror: ${text}`);
    }
  });

  return {
    assertNoErrors() {
      if (errors.length > 0) {
        throw new Error(`Unexpected browser console errors:\n${errors.join("\n")}`);
      }
    },
  };
}
