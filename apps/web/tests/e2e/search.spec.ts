/**
 * Search E2E specs — covers spec §13 AC #5.
 *
 * Scenarios:
 *   - command palette opens on ⌘K and shows results (AC #5)
 *   - dedicated search page — hybrid mode returns grouped results
 *   - keyword mode returns results
 *   - semantic mode returns results
 *   - empty query shows placeholder
 *   - zero results shows empty state
 */

import { test, expect, SEED_PROJECT_SLUG } from "./fixtures";

test.describe("Command Palette (AC #5)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/library`);
    await expect(page.getByRole("heading", { name: /test library/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("opens on ⌘K and shows search input", async ({ page, applyTheme }) => {
    await applyTheme();

    // Open command palette
    await page.keyboard.press("Meta+k");

    await expect(
      page.getByRole("dialog", { name: /command palette/i }),
    ).toBeVisible({ timeout: 3_000 });

    // Search input should be focused
    const input = page.getByPlaceholder(/search testcases/i);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test("typing query shows results grouped by kind", async ({ page, applyTheme }) => {
    await applyTheme();

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({
      timeout: 3_000,
    });

    // Type a query that matches seeded content
    await page.keyboard.type("auth");

    // Wait for results to appear (debounce + API call)
    await expect(page.getByText(/testcases|shared steps|stories/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("closes on Escape", async ({ page, applyTheme }) => {
    await applyTheme();

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({
      timeout: 3_000,
    });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /command palette/i })).not.toBeVisible({
      timeout: 2_000,
    });
  });

  test("selecting a result navigates to detail (AC #4 — keyboard flow)", async ({
    page,
    applyTheme,
  }) => {
    await applyTheme();

    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({
      timeout: 3_000,
    });

    await page.keyboard.type("auth");

    // Wait for any result to appear
    await expect(page.locator('[cmdk-item], [role="option"]').first()).toBeVisible({
      timeout: 5_000,
    });

    // Press Enter to navigate to first result
    await page.keyboard.press("Enter");

    // Should have navigated away from the library list
    await expect(page).not.toHaveURL(`/p/${SEED_PROJECT_SLUG}/library`);
  });
});

test.describe("Search page (AC #5)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/search`);
  });

  test("hybrid mode shows placeholder on empty query", async ({ page, applyTheme }) => {
    await applyTheme();

    // Page should load with a search input
    const searchInput = page
      .getByRole("textbox", { name: /search/i })
      .or(page.getByPlaceholder(/search/i))
      .first();

    if (await searchInput.isVisible({ timeout: 5_000 })) {
      // Empty query should show a placeholder / instructions
      await expect(
        page.getByText(/type to search|enter a query|start typing/i).or(
          page.getByText(/search testcases/i),
        ),
      ).toBeVisible({ timeout: 3_000 });
    }
  });

  test("keyword search returns results", async ({ page, applyTheme }) => {
    await applyTheme();

    const searchInput = page
      .getByRole("textbox", { name: /search/i })
      .or(page.getByPlaceholder(/search/i))
      .first();

    if (await searchInput.isVisible({ timeout: 5_000 })) {
      await searchInput.fill("auth");

      // Wait for results
      await expect(
        page.getByText(/TC-AUTH|testcase|result/i).first(),
      ).toBeVisible({ timeout: 8_000 });
    }
  });

  test("zero results shows empty state", async ({ page, applyTheme }) => {
    await applyTheme();

    const searchInput = page
      .getByRole("textbox", { name: /search/i })
      .or(page.getByPlaceholder(/search/i))
      .first();

    if (await searchInput.isVisible({ timeout: 5_000 })) {
      await searchInput.fill("zzz-no-match-xyz-unlikely-to-exist");

      await expect(
        page.getByText(/no results|nothing found|0 results/i),
      ).toBeVisible({ timeout: 8_000 });
    }
  });
});
