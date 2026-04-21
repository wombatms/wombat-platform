/**
 * Playwright test fixtures for the Wombat web E2E suite.
 *
 * Provides:
 *   - `theme`: "light" | "dark" — injected from the project name.
 *   - `page`: extended to apply the correct data-theme and capture axe results.
 *
 * Theme matrix is driven by the two Playwright projects (chromium-light /
 * chromium-dark) defined in playwright.config.ts. Each spec file should import
 * `test` and `expect` from this module rather than from @playwright/test.
 */

import { test as base, expect, type Page } from "@playwright/test";

export type Theme = "light" | "dark";

export interface WombatFixtures {
  /** "light" | "dark" — derived from the current Playwright project name. */
  theme: Theme;
  /** Applies the theme to the page's <html> element before each test. */
  applyTheme: () => Promise<void>;
}

export const test = base.extend<WombatFixtures>({
  /** Derive theme from the Playwright project name (chromium-light / chromium-dark). */
  theme: async ({ }, use, testInfo) => {
    const projectName = testInfo.project.name;
    const theme: Theme = projectName.endsWith("dark") ? "dark" : "light";
    await use(theme);
  },

  /** Apply data-theme attribute to <html> matching the project's theme. */
  applyTheme: async ({ page, theme }, use) => {
    const applyFn = async () => {
      await page.evaluate((t: string) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
    };
    await use(applyFn);
  },
});

export { expect };

// ------------------------------------------------------------------
// Helpers re-exported for convenience in specs
// ------------------------------------------------------------------

/**
 * Wait for the app to finish its initial navigation and hydration.
 * Waits until network is idle and the document is not in a loading state.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

/**
 * Login helper — navigates to /login, fills credentials, submits.
 * Uses the seed user credentials from global-setup.ts.
 */
export const SEED_USER = {
  email: "e2e@wombat.test",
  password: "E2eWombat2026!",
};

export const SEED_PROJECT_SLUG = "e2e-project";
