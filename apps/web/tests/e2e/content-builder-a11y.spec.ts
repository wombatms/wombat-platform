/**
 * SP3.4 Content-builder and dashboard accessibility spec (SP3.4, Task 63).
 *
 * Axe-core gate (serious + critical violations only) applied to:
 *   - /p/:slug/plans/new        (ContentBuilder for plan creation)
 *   - /p/:slug/suites/new       (ContentBuilder for suite creation)
 *   - /p/:slug                  (ProjectDashboardPage)
 *   - /p/:slug/plans/:wid/dashboard  (PlanDashboardPage — needs a seeded plan)
 *
 * Gate: zero serious + critical violations (matching existing axe.helper.ts).
 * Moderate and minor violations are logged as informational warnings.
 *
 * Light + dark matrix via the two Playwright projects (chromium-light /
 * chromium-dark). Each combination runs the full suite, so the matrix is:
 *   4 routes × 2 themes = 8 axe scans.
 *
 * Prerequisites (provided by global-setup.ts):
 *   - Seed user (e2e@wombat.test) authenticated.
 *   - e2e-project exists.
 *   - TC-AUTH-001 seed case exists.
 */

import { test, expect, SEED_PROJECT_SLUG, SEED_USER } from "./fixtures";
import { axeScan } from "./axe.helper";

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

/**
 * Ensure at least one published plan exists so the PlanDashboardPage has
 * a real wombat_id to use. Returns the plan wombat_id or null if seeding
 * fails and no plans are available.
 */
async function ensurePlanWid(token: string): Promise<string | null> {
  const planWid = `PLAN-A11Y-${Date.now()}`;
  const planTitle = `A11y seed plan ${Date.now()}`;

  try {
    await apiPost(
      `/api/projects/${SEED_PROJECT_SLUG}/proposals`,
      {
        kind: "plan",
        source_path: `plans/${planWid}.md`,
        base_revision: "HEAD",
        proposed_title: planTitle,
        proposed_body: {
          title: planTitle,
          include: {},
          exclude: {},
          suite_refs: [],
          explicit_cases: { add: ["TC-AUTH-001"], remove: [] },
        },
        proposal_action: "upsert",
      },
      token,
    );
  } catch (e) {
    console.warn("[content-builder-a11y] Plan seed failed:", String(e));
  }

  // Discover any available plan from the plans list endpoint
  try {
    const plans = (await apiGet(
      `/api/projects/${SEED_PROJECT_SLUG}/plans`,
      token,
    )) as
      | { items?: Array<{ wombat_id: string }>; data?: Array<{ wombat_id: string }> }
      | Array<{ wombat_id: string }>;

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
    console.warn("[content-builder-a11y] Could not list plans:", String(e));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Axe gates — SP3.4 surfaces
// ---------------------------------------------------------------------------

test.describe("SP3.4 a11y — ContentBuilder: plans/new", () => {
  test("plans/new page passes axe gate", async ({ page, applyTheme }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/plans/new`);
    await applyTheme();
    await page.waitForLoadState("networkidle");

    // Wait for the ContentBuilder to render. It shows a title input + two panes.
    // Accept either the ContentBuilder shell or a breadcrumb nav (both indicate
    // the page loaded; the builder may still be hydrating).
    const builderLoaded = page
      .getByPlaceholder(/content title/i)
      .or(page.getByPlaceholder(/plan title/i))
      .or(page.getByText(/new plan/i).first())
      .or(page.getByText(/plans/i).first());

    await expect(builderLoaded).toBeVisible({ timeout: 15_000 });

    // Wait for any lazy-loaded widgets or spinners to settle
    await page.waitForLoadState("networkidle");

    await axeScan(page);
  });
});

test.describe("SP3.4 a11y — ContentBuilder: suites/new", () => {
  test("suites/new page passes axe gate", async ({ page, applyTheme }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}/suites/new`);
    await applyTheme();
    await page.waitForLoadState("networkidle");

    // Wait for the ContentBuilder (suite mode) to render
    const builderLoaded = page
      .getByPlaceholder(/content title/i)
      .or(page.getByPlaceholder(/suite title/i))
      .or(page.getByText(/new suite/i).first())
      .or(page.getByText(/suites/i).first());

    await expect(builderLoaded).toBeVisible({ timeout: 15_000 });

    await page.waitForLoadState("networkidle");

    await axeScan(page);
  });
});

test.describe("SP3.4 a11y — ProjectDashboardPage", () => {
  test("project dashboard page passes axe gate", async ({ page, applyTheme }) => {
    await page.goto(`/p/${SEED_PROJECT_SLUG}`);
    await applyTheme();
    await page.waitForLoadState("networkidle");

    // Wait for the page to be meaningful: either the WelcomeState or the
    // dashboard FilterBar must be visible. Both are valid renders.
    const pageContent = page
      .getByText(/create plan/i)
      .or(page.getByText(/no activity yet/i))
      .or(page.getByRole("group", { name: /time window/i }))
      .or(page.getByText(/window/i).first())
      .or(page.getByText(/recent runs/i).first())
      .or(page.getByText(/pass.*fail.*trend/i).first());

    await expect(pageContent).toBeVisible({ timeout: 20_000 });

    // Allow widgets to finish loading (most will settle quickly without API data)
    await page.waitForTimeout(2_000);

    // Exclude any charts/canvas elements from axe — recharts SVGs sometimes
    // generate informational color-contrast violations on the chart axes.
    // We keep them in scope but note they are excluded from the blocking gate
    // via the existing axe.helper severity filter.
    await axeScan(page);
  });
});

test.describe("SP3.4 a11y — PlanDashboardPage", () => {
  test("plan dashboard page passes axe gate", async ({ page, applyTheme }) => {
    // Seed / discover a plan to have a real wombat_id
    let planWid: string | null = null;

    try {
      const token = await login();
      planWid = await ensurePlanWid(token);
    } catch (e) {
      console.warn("[content-builder-a11y] Plan discovery failed:", String(e));
    }

    if (!planWid) {
      test.skip(
        true,
        "No published plan available for plan dashboard a11y scan. " +
        "Create and approve a plan (SP3.4 Task 8) to enable this test.",
      );
      return;
    }

    await page.goto(`/p/${SEED_PROJECT_SLUG}/plans/${planWid}/dashboard`);
    await applyTheme();
    await page.waitForLoadState("networkidle");

    // Wait for the plan dashboard layout to render:
    //  - Breadcrumb with "Plan" link
    //  - Page heading "Dashboard"
    //  - At least one widget title
    const dashboardContent = page
      .getByRole("heading", { name: /dashboard/i })
      .or(page.getByText(/pass.*fail.*trend/i).first())
      .or(page.getByText(/release readiness/i).first());

    await expect(dashboardContent).toBeVisible({ timeout: 20_000 });

    // Let widgets finish loading
    await page.waitForTimeout(2_000);

    await axeScan(page);
  });
});
