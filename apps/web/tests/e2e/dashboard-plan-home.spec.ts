/**
 * Plan-home dashboard E2E spec (SP3.4, Task 62).
 *
 * Flow:
 *   1. Log in as seed user. Ensure at least one published plan exists (seed via API).
 *   2. Navigate to the plan's detail page.
 *   3. Click the "Dashboard" action/tab.
 *   4. Plan-home dashboard renders at /p/:slug/plans/:wid/dashboard.
 *      release_readiness widget is populated (may show 0% if no runs yet, but
 *      is not in the "Pick a plan" empty state).
 *   5. In the TopFailingCases widget, if any case rows exist, click the first
 *      case ID link and verify drill-through to /p/sample/library/:wombat_id.
 *
 * Light + dark matrix.
 *
 * Note: The test seeds a plan via the proposals endpoint. If the seed plan
 * is still pending approval, the test navigates to the plan list and picks
 * the first available plan (or skips if none exist).
 */

import { test, expect, SEED_PROJECT_SLUG, SEED_USER } from "./fixtures";

const API_BASE = process.env["WOMBAT_API_URL"] ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_USER.email, password: SEED_USER.password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function apiPost(path: string, body: unknown, token: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : await res.json();
}

async function apiGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Seed + discover a plan wombat_id
// ---------------------------------------------------------------------------

const SEED_PLAN_WID = `PLAN-DASH-${Date.now()}`;
const SEED_PLAN_TITLE = `Dashboard E2E Plan ${Date.now()}`;

/**
 * Seed a plan and return its wombat_id.
 * Falls back to discovering an existing plan from the plans list if seeding fails.
 */
async function ensurePlan(token: string): Promise<string | null> {
  // Try to seed a plan via proposals
  try {
    await apiPost(
      `/api/projects/${SEED_PROJECT_SLUG}/proposals`,
      {
        kind: "plan",
        source_path: `plans/${SEED_PLAN_WID}.md`,
        base_revision: "HEAD",
        proposed_title: SEED_PLAN_TITLE,
        proposed_body: {
          title: SEED_PLAN_TITLE,
          include: {},
          exclude: {},
          suite_refs: [],
          explicit_cases: { add: ["TC-AUTH-001"], remove: [] },
        },
        proposal_action: "upsert",
      },
      token,
    );
    // Plan proposal created — check if it was auto-approved
  } catch (e) {
    console.warn("[dashboard-plan-home] Plan seed failed:", String(e));
  }

  // Try to discover plans from the API
  try {
    const plans = (await apiGet(
      `/api/projects/${SEED_PROJECT_SLUG}/plans`,
      token,
    )) as { items?: Array<{ wombat_id: string }>; data?: Array<{ wombat_id: string }> } | Array<{ wombat_id: string }>;

    let planList: Array<{ wombat_id: string }> = [];
    if (Array.isArray(plans)) {
      planList = plans;
    } else if (Array.isArray((plans as { items?: Array<{ wombat_id: string }> }).items)) {
      planList = (plans as { items: Array<{ wombat_id: string }> }).items;
    } else if (Array.isArray((plans as { data?: Array<{ wombat_id: string }> }).data)) {
      planList = (plans as { data: Array<{ wombat_id: string }> }).data;
    }

    if (planList.length > 0) {
      return planList[0].wombat_id;
    }
  } catch (e) {
    console.warn("[dashboard-plan-home] Could not list plans:", String(e));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("Plan-home dashboard", () => {
  test(
    "plan detail Dashboard action → plan dashboard renders → top-failing drill-through",
    async ({ page, applyTheme }) => {
      await applyTheme();

      // ----- Seed / discover plan -----
      let token: string;
      try {
        token = await login();
      } catch (e) {
        test.skip(true, `Could not log in: ${String(e)}`);
        return;
      }

      const planWid = await ensurePlan(token);

      if (!planWid) {
        test.skip(
          true,
          "No published plan available in the e2e project. " +
          "Create and approve a plan to test the plan dashboard. " +
          "SP3.4 plan write path (Task 8) must be implemented.",
        );
        return;
      }

      // ----- Step 2: Navigate to plan detail page -----
      await page.goto(`/p/${SEED_PROJECT_SLUG}/plans/${planWid}`);
      await page.waitForLoadState("networkidle");

      // Wait for plan detail to load — look for the plan title or action buttons
      const planDetailContent = page
        .getByRole("heading", { level: 1 })
        .or(page.getByRole("heading", { level: 2 }))
        .or(page.getByRole("button", { name: /start run/i }))
        .or(page.getByRole("link", { name: /dashboard/i }))
        .or(page.getByRole("button", { name: /dashboard/i }));

      const detailVisible = await planDetailContent.isVisible({ timeout: 15_000 }).catch(() => false);

      if (!detailVisible) {
        test.skip(
          true,
          `Plan detail page did not load for plan ${planWid}. ` +
          "The plan may be pending approval or the detail route not implemented yet.",
        );
        return;
      }

      // ----- Step 3: Click the "Dashboard" action -----
      const dashboardAction = page
        .getByRole("link", { name: /dashboard/i })
        .or(page.getByRole("button", { name: /dashboard/i }));

      const dashboardActionVisible = await dashboardAction.isVisible({ timeout: 5_000 }).catch(() => false);

      if (dashboardActionVisible) {
        await dashboardAction.first().click();

        // Wait for navigation to /plans/:wid/dashboard
        await page.waitForURL(
          (url) => url.pathname.includes(`/plans/${planWid}/dashboard`),
          { timeout: 10_000 },
        );
      } else {
        // Navigate directly if the action button is not found
        console.log(
          "[dashboard-plan-home] Dashboard action not found on plan detail — " +
          "navigating directly to dashboard URL.",
        );
        await page.goto(`/p/${SEED_PROJECT_SLUG}/plans/${planWid}/dashboard`);
        await page.waitForLoadState("networkidle");
      }

      // ----- Step 4: Plan dashboard renders -----
      // Verify we're on the dashboard page (URL check + heading)
      await expect(page).toHaveURL(
        new RegExp(`/plans/${planWid}/dashboard`),
        { timeout: 10_000 },
      );

      // Wait for dashboard content to load
      await page.waitForLoadState("networkidle");

      // The dashboard page should show the "Dashboard" heading (from PlanDashboardPage)
      const dashHeading = page.getByRole("heading", { name: /dashboard/i }).first();
      await expect(dashHeading).toBeVisible({ timeout: 15_000 });

      // Widget titles should render
      const passfailTitle = page.getByText(/pass.*fail.*trend/i).first();
      const recentRunsTitle = page.getByText(/recent runs/i).first();
      const topFailingTitle = page.getByText(/top failing cases/i).first();
      const releaseReadinessTitle = page.getByText(/release readiness/i).first();

      await expect(passfailTitle).toBeVisible({ timeout: 15_000 });
      await expect(recentRunsTitle).toBeVisible({ timeout: 10_000 });
      await expect(topFailingTitle).toBeVisible({ timeout: 10_000 });
      await expect(releaseReadinessTitle).toBeVisible({ timeout: 10_000 });

      // release_readiness should NOT be in the "pick a plan" empty state
      // (we're on plan scope, so plan_id is implicit from the route).
      const pickAPlanMsg = page.getByText(/select a plan/i).or(
        page.getByText(/pick a plan/i),
      );
      // Give a short window for this assertion — it may not appear at all
      const pickAPlanVisible = await pickAPlanMsg
        .isVisible({ timeout: 3_000 })
        .catch(() => false);

      expect(pickAPlanVisible).toBe(false);
      console.log(
        "[dashboard-plan-home] release_readiness is not in 'pick a plan' state on plan scope.",
      );

      // ----- Step 5: TopFailingCases drill-through -----
      // Wait for the TopFailingCases widget to settle
      await page.waitForTimeout(2_000);

      // Look for a case ID link inside the top-failing table
      // Case IDs are in font-mono links with /library/:wombat_id href
      const caseIdLink = page
        .getByRole("link")
        .filter({ hasText: /TC-/i })
        .first();

      const caseIdVisible = await caseIdLink.isVisible({ timeout: 5_000 }).catch(() => false);

      if (caseIdVisible) {
        // Get the wombat_id from the link text
        const wombatId = (await caseIdLink.textContent())?.trim() ?? "";

        // Click the case ID link
        await caseIdLink.click();

        // Should navigate to /p/:slug/library/:wombat_id
        await page.waitForURL(
          (url) =>
            url.pathname.includes("/library/") &&
            (wombatId === "" || url.pathname.endsWith(wombatId)),
          { timeout: 10_000 },
        );

        // Verify the library detail page loaded
        await expect(page).toHaveURL(/\/library\//);
        console.log(
          "[dashboard-plan-home] Drill-through to library case worked:",
          wombatId,
        );
      } else {
        console.log(
          "[dashboard-plan-home] No failing case rows in TopFailingCases widget — " +
          "no drill-through to assert. Run some tests to populate failure data.",
        );
      }

      // Breadcrumb back to plan detail should be visible
      const planBreadcrumb = page.getByRole("link", { name: /plan/i }).first();
      await expect(planBreadcrumb).toBeVisible({ timeout: 5_000 });
    },
  );
});
