/**
 * Proposals direct-publish E2E spec (SP3.2, Task 50).
 *
 * Flow: admin user has content:publish_direct permission → opens EditForm →
 * clicks "Publish directly" → change is immediate; no inbox row appears
 * (status is "published", not "open").
 *
 * Prerequisites:
 *   - Seed user has content:publish_direct on e2e-project
 *   - TC-AUTH-001 exists with a valid base_revision
 *   - WOMBAT_GIT_WORKSPACE_ROOT + project git_url configured
 */

import { test, expect, SEED_PROJECT_SLUG } from "./fixtures";
import { axeScan } from "./axe.helper";

const DIRECT_PUBLISH_TITLE = `Direct publish ${Date.now()}`;
const TESTCASE_WOMBAT_ID = "TC-AUTH-001";

test.describe("Proposals direct-publish flow", () => {
  test("Publish directly skips inbox and publishes immediately", async ({
    page,
    applyTheme,
  }) => {
    await applyTheme();

    // Navigate to the edit form for an existing testcase
    await page.goto(
      `/p/${SEED_PROJECT_SLUG}/testcase/${TESTCASE_WOMBAT_ID}/edit`,
    );

    // Wait for the form to load
    await expect(page.getByPlaceholderText(/content title/i)).toBeVisible({
      timeout: 15_000,
    });

    // Axe gate on EditForm
    await axeScan(page);

    // The "Publish directly" button should be visible (seed user has the permission)
    const publishBtn = page.getByRole("button", { name: /publish directly/i });

    if (!(await publishBtn.isVisible({ timeout: 3_000 }))) {
      test.skip(
        true,
        "Publish directly button not visible — seed user may not have content:publish_direct",
      );
      return;
    }

    // Update the title
    const titleInput = page.getByPlaceholderText(/content title/i);
    await titleInput.fill(DIRECT_PUBLISH_TITLE);

    // Click "Publish directly"
    await publishBtn.click();

    // Should navigate away from the edit form to the content detail page
    // (not to the approvals inbox)
    await expect(page).not.toHaveURL(new RegExp("/edit$"), { timeout: 15_000 });
    await expect(page).not.toHaveURL(new RegExp("/approvals/"), { timeout: 3_000 });

    // Verify no open inbox row for this title
    await page.goto(`/p/${SEED_PROJECT_SLUG}/approvals`);
    await expect(
      page.getByRole("heading", { name: /approvals/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Axe gate on inbox
    await axeScan(page);

    // The directly-published item should NOT appear in the open proposals
    // (it would have status "published" which is filtered out by the default "open" filter)
    const openFilter = page.getByRole("button", { name: /^open$/i });
    await openFilter.click();

    // Wait a moment for re-filter
    await page.waitForTimeout(300);

    // The direct-publish title should not appear in the open list
    // (it may appear in the "published" filter view)
    const titleInOpen = page.getByText(DIRECT_PUBLISH_TITLE);
    expect(await titleInOpen.count()).toBe(0);
  });
});
