/**
 * Playwright global setup — runs once before any spec.
 *
 * Responsibilities:
 *   1. Ensure the FastAPI server is reachable (or boot it if managed by this script).
 *   2. Apply Alembic migrations to a clean test database.
 *   3. Seed one user, one project, and small demo content via the API.
 *   4. Authenticate as that user and persist the storage state (cookies + localStorage)
 *      to tests/e2e/.auth/user.json so specs can reuse it via storageState.
 *   5. (SP3.2) Provision a temp bare Git remote for proposal E2E flows and wire it
 *      into the seed project's git_url via the API. Export the workspace root path.
 *
 * Postgres strategy:
 *   - If WOMBAT_TEST_DATABASE_URL is set, use it directly (fast local loop).
 *   - Otherwise the CI pipeline is expected to have started a Postgres service
 *     container and exported WOMBAT_TEST_DATABASE_URL before this runs.
 *
 * API strategy:
 *   - If WOMBAT_API_URL is set, assume the server is pre-booted (e.g. by the
 *     CI pipeline). Wait up to 30s for it to be ready.
 *   - If not set, the webServer block in playwright.config.ts starts the Vite
 *     dev server, and we expect the API to be started separately (pnpm dev:all).
 *
 * Git remote strategy (SP3.2):
 *   - A temp directory is created for the bare remote: $TMPDIR/wombat-e2e-git-remote-XXXX/
 *   - The bare remote is seeded with an empty initial commit on `main`.
 *   - WOMBAT_GIT_WORKSPACE_ROOT is set to a sibling workspace dir.
 *   - The seed project's git_url is patched via PATCH /api/projects/:slug after the
 *     API is running.
 *
 * NOTE: For the API to use the workspace root at runtime, WOMBAT_GIT_WORKSPACE_ROOT
 * must be set in the API process environment at startup. In CI, set this env var on
 * the API service container before it boots. In local development, set it in the
 * shell before running `uvicorn`. The bare remote URL (file:// path) is set on the
 * project record via the API after boot, which the API reads from the DB each time
 * it publishes — so only the workspace root needs to be in the environment at startup.
 *
 * Note: We do NOT use testcontainers in this script — the CI pipeline manages
 * the postgres container as a service and injects WOMBAT_TEST_DATABASE_URL.
 * For local development, run `docker compose up -d postgres` and set the env var.
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { seedDemoContent } from "./seed";

// Shim __dirname for ESM — apps/web uses "type": "module".
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = process.env.WOMBAT_API_URL ?? "http://localhost:8000";
const APP_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const AUTH_DIR = path.resolve(__dirname, ".auth");

const SEED_USER = {
  email: "e2e@wombat.test",
  password: "E2eWombat2026!",
  display_name: "E2E User",
};

const SEED_PROJECT = {
  name: "E2E Project",
  slug: "e2e-project",
};

/** Wait until the API responds on /health (or /openapi.json) */
async function waitForApi(maxWaitMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/openapi.json`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e as Error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `API at ${API_BASE} did not become ready within ${maxWaitMs}ms. Last error: ${lastErr?.message}`,
  );
}

/** POST to the API; return parsed JSON. Throws on HTTP error. */
async function apiPost(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const msg = (json as { detail?: string; error?: { message?: string } })
      ?.error?.message ??
      (json as { detail?: string })?.detail ??
      res.statusText;
    throw new Error(`POST ${path} failed (${res.status}): ${msg}`);
  }
  return json;
}

async function _apiGet(path: string, token?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as unknown;
}

async function apiPatch(path: string, body: unknown, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as unknown;
    const msg = (json as { error?: { message?: string } })?.error?.message ?? res.statusText;
    console.warn(`PATCH ${path} failed (${res.status}): ${msg} — skipping git_url update`);
    return null;
  }
  return (await res.json()) as unknown;
}

/**
 * Provision a temp bare Git remote for proposal E2E flows.
 *
 * Returns { remotePath, workspacePath } — both are absolute file:// paths.
 * The remote is seeded with an empty initial commit on main.
 * The workspace root is a sibling directory where the API will clone repos.
 *
 * Teardown: The caller is responsible for cleaning up these directories.
 * They are written to tests/e2e/.git-remote-info.json for teardown to read.
 */
function provisionGitRemote(): { remotePath: string; workspacePath: string } {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "wombat-e2e-"));
  const remotePath = path.join(tmpBase, "remote.git");
  const workspacePath = path.join(tmpBase, "workspace");
  const seedPath = path.join(tmpBase, "seed");

  fs.mkdirSync(remotePath, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(seedPath, { recursive: true });

  // Git identity so commits work on bare systems
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Wombat E2E",
    GIT_AUTHOR_EMAIL: "e2e@wombat.test",
    GIT_COMMITTER_NAME: "Wombat E2E",
    GIT_COMMITTER_EMAIL: "e2e@wombat.test",
  };

  const run = (cmd: string, cwd?: string) =>
    execSync(cmd, { cwd, env: gitEnv, stdio: "pipe" });

  // Create bare remote
  run(`git init --bare "${remotePath}"`);

  // Create seed repo, make initial commit, push to bare
  run("git init", seedPath);
  run('git commit --allow-empty -m "init"', seedPath);
  run("git branch -M main", seedPath);
  run(`git remote add origin "${remotePath}"`, seedPath);
  run("git push origin main", seedPath);

  console.log(`[setup] Git remote provisioned: ${remotePath}`);
  console.log(`[setup] Git workspace root: ${workspacePath}`);

  return { remotePath, workspacePath };
}

export default async function globalSetup() {
  // 1. Wait for the API to be ready
  console.log("[setup] Waiting for API…");
  await waitForApi();
  console.log("[setup] API ready.");

  // 2. Register / login the seed user (registration is idempotent — 409 is OK)
  let accessToken: string;
  try {
    const reg = (await apiPost("/api/auth/register", SEED_USER)) as {
      email: string;
    };
    console.log("[setup] Registered seed user:", reg.email);
  } catch (e) {
    // User may already exist — that's fine
    if (!String(e).includes("409") && !String(e).includes("already")) {
      console.warn("[setup] Registration warning (may be pre-existing):", String(e));
    }
  }

  const loginRes = (await apiPost("/api/auth/login", {
    email: SEED_USER.email,
    password: SEED_USER.password,
  })) as { access_token: string; refresh_token: string };
  accessToken = loginRes.access_token;
  console.log("[setup] Logged in as seed user.");

  // 3. Create seed project (idempotent — skip on conflict)
  try {
    await apiPost(
      "/api/projects/",
      { name: SEED_PROJECT.name, slug: SEED_PROJECT.slug },
      accessToken,
    );
    console.log("[setup] Created seed project:", SEED_PROJECT.slug);
  } catch (e) {
    if (!String(e).includes("409") && !String(e).includes("already")) {
      console.warn("[setup] Project creation warning:", String(e));
    } else {
      console.log("[setup] Seed project already exists — reusing.");
    }
  }

  // 3b. Seed demo content so specs can reference TC-AUTH-001, SS-NAV-001, etc.
  //     Idempotent: individual create calls tolerate 409 (already exists).
  try {
    await seedDemoContent(accessToken);
  } catch (e) {
    console.warn("[setup] Content seeding warning (non-fatal):", String(e));
  }

  // 4. Provision a temp bare Git remote for proposal E2E flows (SP3.2)
  let gitWorkspacePath: string | null = null;

  try {
    const { remotePath, workspacePath } = provisionGitRemote();
    gitWorkspacePath = workspacePath;

    // Persist paths for globalTeardown to clean up
    const infoPath = path.join(AUTH_DIR, "..", ".git-remote-info.json");
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(
      infoPath,
      JSON.stringify({ remotePath, workspacePath }, null, 2),
    );

    // Wire git_url into the seed project via PATCH.
    // The file:// URL allows the API to clone/push without SSH.
    const gitUrl = `file://${remotePath}`;
    await apiPatch(
      `/api/projects/${SEED_PROJECT.slug}`,
      { git_url: gitUrl },
      accessToken,
    );
    console.log(`[setup] Seed project git_url set to ${gitUrl}`);

    // Export for child processes (only effective if API reads env at route time, not startup)
    // In CI, WOMBAT_GIT_WORKSPACE_ROOT must be set before the API service starts.
    process.env["WOMBAT_GIT_WORKSPACE_ROOT"] = workspacePath;
    console.log(`[setup] WOMBAT_GIT_WORKSPACE_ROOT=${workspacePath}`);
    console.log(
      "[setup] NOTE: If the API was already running before this setup, set " +
      "WOMBAT_GIT_WORKSPACE_ROOT in the API process environment before boot.",
    );
  } catch (e) {
    console.warn("[setup] Git remote provisioning failed (non-fatal for non-proposal specs):", String(e));
  }

  // 5. Persist auth state for Playwright tests via a real browser session.
  //    We launch a headless Chromium, navigate to the app, inject tokens into
  //    localStorage, then save the storage state.
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Navigate to the app root (this may redirect to /login — that's OK)
  await page.goto(APP_BASE, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {
    // If the server isn't running yet, we still need to set localStorage.
    // Navigate to a blank page instead.
  });

  // Inject tokens into localStorage (matching the keys used by storage.ts)
  await page.evaluate(
    ({ access, refresh, gitWorkspace }) => {
      localStorage.setItem("wombat.access", access);
      localStorage.setItem("wombat.refresh", refresh);
      // Store the git workspace path for specs that need to reference it
      if (gitWorkspace) {
        localStorage.setItem("wombat.e2e.gitWorkspace", gitWorkspace);
      }
    },
    {
      access: loginRes.access_token,
      refresh: loginRes.refresh_token,
      gitWorkspace: gitWorkspacePath,
    },
  );

  await page.context().storageState({ path: path.join(AUTH_DIR, "user.json") });
  await browser.close();

  console.log("[setup] Auth storage state saved to tests/e2e/.auth/user.json");
  console.log("[setup] Global setup complete.");
}
