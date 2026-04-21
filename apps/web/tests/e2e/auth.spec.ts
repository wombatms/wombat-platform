/**
 * Auth E2E specs — covers spec §13 AC #1, AC #8.
 *
 * Scenarios:
 *   - login success (AC #1)
 *   - login failure (shows error)
 *   - session survives reload (AC #8)
 *   - logout clears state
 */

import { test, expect, SEED_USER, SEED_PROJECT_SLUG } from "./fixtures";
import { axeScan } from "./axe.helper";

test.describe("Authentication", () => {
  // These tests start without auth state (override storageState to empty)
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login success — navigates to library", async ({ page, applyTheme }) => {
    await page.goto("/login");
    await applyTheme();

    // Axe scan the login page before filling the form
    await axeScan(page);

    await page.fill('input[name="email"], input[type="email"]', SEED_USER.email);
    await page.fill('input[name="password"], input[type="password"]', SEED_USER.password);
    await page.click('button[type="submit"]');

    // Should land on project picker or library
    await expect(page).toHaveURL(/\/(projects|p\/)/, { timeout: 10_000 });
  });

  test("login failure — shows error message", async ({ page, applyTheme }) => {
    await page.goto("/login");
    await applyTheme();

    await page.fill('input[name="email"], input[type="email"]', SEED_USER.email);
    await page.fill('input[name="password"], input[type="password"]', "wrong-password!");
    await page.click('button[type="submit"]');

    await expect(
      page.getByText(/invalid email or password|incorrect/i),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Session persistence", () => {
  test("session survives page reload (AC #8)", async ({ page, applyTheme }) => {
    // storageState from config already has valid tokens
    await page.goto(`/p/${SEED_PROJECT_SLUG}/library`);
    await applyTheme();

    // Wait for library to be visible (not redirected to login)
    await expect(page.getByRole("heading", { name: /test library/i })).toBeVisible({
      timeout: 10_000,
    });

    // Axe scan the library page
    await axeScan(page);

    // Reload the page
    await page.reload();

    // Should still be on library, NOT redirected to login
    await expect(page.getByRole("heading", { name: /test library/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("logout clears session and redirects to login", async ({ page, applyTheme }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/library`);
    await applyTheme();

    await expect(page.getByRole("heading", { name: /test library/i })).toBeVisible({
      timeout: 10_000,
    });

    // Open user menu and click logout
    const userMenu = page.getByRole("button", { name: /user menu|account|sign out/i });
    if (await userMenu.isVisible()) {
      await userMenu.click();
      const logoutBtn = page.getByRole("menuitem", { name: /log out|sign out/i });
      if (await logoutBtn.isVisible()) {
        await logoutBtn.click();
      }
    } else {
      // Fallback: look for a logout link directly
      const logoutLink = page.getByRole("link", { name: /log out|sign out/i });
      if (await logoutLink.isVisible()) {
        await logoutLink.click();
      }
    }

    // Should be on login page
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
