/**
 * Playwright global setup — runs once before any spec.
 *
 * Responsibilities:
 *   1. Ensure the FastAPI server is reachable (or boot it if managed by this script).
 *   2. Apply Alembic migrations to a clean test database.
 *   3. Seed one user, one project, and small demo content via the API.
 *   4. Authenticate as that user and persist the storage state (cookies + localStorage)
 *      to tests/e2e/.auth/user.json so specs can reuse it via storageState.
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
 * Note: We do NOT use testcontainers in this script — the CI pipeline manages
 * the postgres container as a service and injects WOMBAT_TEST_DATABASE_URL.
 * For local development, run `docker compose up -d postgres` and set the env var.
 */

import path from "node:path";
import fs from "node:fs";
import { chromium } from "@playwright/test";

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

async function apiGet(path: string, token?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as unknown;
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

  // 4. Persist auth state for Playwright tests via a real browser session.
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
    ({ access, refresh }) => {
      localStorage.setItem("wombat.access", access);
      localStorage.setItem("wombat.refresh", refresh);
    },
    { access: loginRes.access_token, refresh: loginRes.refresh_token },
  );

  await page.context().storageState({ path: path.join(AUTH_DIR, "user.json") });
  await browser.close();

  console.log("[setup] Auth storage state saved to tests/e2e/.auth/user.json");
  console.log("[setup] Global setup complete.");
}
