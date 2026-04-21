/**
 * E2E content seeder.
 *
 * Seeds the demo content fixtures into the test database via the Wombat API.
 * Called from global-setup.ts after the seed user and project are created.
 *
 * Two strategies:
 *   1. `wombat sync` CLI (preferred when available): ingests YAML fixture files
 *      from tests/fixtures/content/ directly into the project.
 *   2. Direct API calls (fallback): creates individual content items via POST.
 *
 * The fixtures are small (3 testcases, 1 shared step, 1 story) and deliberately
 * minimal — enough to cover all smoke scenarios without bloating setup time.
 *
 * For the 5,000-row virtualization test (AC #2), we generate the rows
 * programmatically rather than storing them in YAML.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const API_BASE = process.env.WOMBAT_API_URL ?? "http://localhost:8000";
const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/content");

const SEED_PROJECT_SLUG = "e2e-project";

async function apiPost(
  endpoint: string,
  body: unknown,
  token: string,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : (await res.json());
}

/**
 * Try to use `wombat sync` CLI if available.
 * Falls back to direct API seeding if the CLI isn't installed.
 */
export async function seedDemoContent(accessToken: string): Promise<void> {
  // Attempt wombat sync first
  const wombatBin = path.resolve(__dirname, "../../../../packages/wombat-cli/dist/wombat.js");
  if (fs.existsSync(wombatBin)) {
    try {
      execSync(
        `node ${wombatBin} sync --project ${SEED_PROJECT_SLUG} --dir ${FIXTURE_DIR} --api-url ${API_BASE} --token ${accessToken}`,
        { stdio: "pipe" },
      );
      console.log("[seed] wombat sync completed.");
      return;
    } catch (e) {
      console.warn("[seed] wombat sync failed, falling back to direct API seeding:", String(e));
    }
  }

  // Fallback: seed via direct API calls
  console.log("[seed] Seeding content via direct API calls…");

  const testcases = [
    {
      wombat_id: "TC-AUTH-001",
      title: "User can log in with valid credentials",
      kind: "testcase",
      component: "auth",
      priority: "high",
      tags: ["smoke", "login", "auth"],
      automation: "automated",
      body: "## Steps\n1. Navigate to /login\n2. Enter valid credentials\n3. Submit\n\n## Expected\nUser is redirected to the library.",
    },
    {
      wombat_id: "TC-AUTH-002",
      title: "Login fails with invalid password",
      kind: "testcase",
      component: "auth",
      priority: "high",
      tags: ["auth", "negative"],
      automation: "automated",
      body: "## Steps\n1. Enter wrong password\n\n## Expected\nError message shown.",
    },
    {
      wombat_id: "TC-SEARCH-001",
      title: "Hybrid search returns relevant results",
      kind: "testcase",
      component: "search",
      priority: "med",
      tags: ["search", "smoke"],
      automation: "automated",
      body: "## Description\nHybrid search returns results.\n\n## Steps\n1. Open command palette\n2. Type a query\n\n## Expected\nResults appear grouped.",
    },
  ];

  const sharedSteps = [
    {
      wombat_id: "SS-NAV-001",
      title: "Navigate to the Wombat application",
      kind: "shared_step",
      tags: ["navigation", "smoke"],
      body: "1. Open browser\n2. Navigate to app URL",
    },
  ];

  const stories = [
    {
      wombat_id: "ST-AUTH-001",
      title: "User Authentication Flow",
      kind: "story",
      tags: ["auth", "smoke"],
      body: "## As a user\nI want to log in\nSo that I can access the platform",
    },
  ];

  const base = `/api/projects/${SEED_PROJECT_SLUG}`;

  for (const tc of testcases) {
    await apiPost(`${base}/testcases`, tc, accessToken).catch((e) => {
      if (!String(e).includes("409")) console.warn("[seed] testcase:", String(e));
    });
  }

  for (const ss of sharedSteps) {
    await apiPost(`${base}/shared-steps`, ss, accessToken).catch((e) => {
      if (!String(e).includes("409")) console.warn("[seed] shared-step:", String(e));
    });
  }

  for (const story of stories) {
    await apiPost(`${base}/stories`, story, accessToken).catch((e) => {
      if (!String(e).includes("409")) console.warn("[seed] story:", String(e));
    });
  }

  console.log("[seed] Direct API seeding complete.");
}
