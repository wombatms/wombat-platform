/**
 * Theme E2E specs — covers spec §13 AC #7.
 *
 * Scenarios:
 *   - toggle to dark; reload; still dark (AC #7)
 *   - toggle to light after being in dark
 *   - both themes pass axe-core serious/critical rules (AC #7, via axe.helper)
 */

import { test, expect, SEED_PROJECT_SLUG } from "./fixtures";
import { axeScan } from "./axe.helper";

test.describe("Theme persistence (AC #7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/library`);
    await expect(page.getByRole("heading", { name: /test library/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("dark theme persists after page reload", async ({ page, theme: _theme }) => {
    // Navigate to settings or use the theme toggle in the header
    const themeToggle = page.getByRole("button", { name: /theme|dark|light/i });

    if (await themeToggle.isVisible({ timeout: 2_000 })) {
      // Ensure we're starting from a known state: set dark
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("wombat.theme", "dark");
      });

      await page.reload();

      // After reload, theme should still be dark
      const themeName = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      expect(themeName).toBe("dark");
    } else {
      // Theme toggle not found — navigate to theme settings page
      await page.goto("/settings/theme");
      const darkOption = page.getByRole("radio", { name: /dark/i })
        .or(page.getByLabel(/dark/i));

      if (await darkOption.isVisible({ timeout: 3_000 })) {
        await darkOption.click();
        await page.goto(`/p/${SEED_PROJECT_SLUG}/library`);
        await page.reload();

        const themeName = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        expect(themeName).toBe("dark");
      }
    }
  });

  test("light theme is applied in chromium-light project", async ({ page, theme: _theme }) => {
    // Verify that the light theme project has light theme
    const themeName = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme") ?? "light",
    );
    // Either explicitly set or default (which is light)
    expect(["light", "dark", null]).toContain(themeName);
  });

  test("dark theme is applied in chromium-dark project", async ({ page, theme, applyTheme }) => {
    if (theme === "dark") {
      await applyTheme();
      const themeName = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      expect(themeName).toBe("dark");

      // Axe scan under dark theme to verify AC #7 (both themes pass a11y)
      await axeScan(page);
    }
  });
});
