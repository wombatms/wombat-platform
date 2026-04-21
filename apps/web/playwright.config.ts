import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shim __dirname for ESM — apps/web sets "type": "module" in package.json,
// so Playwright's config loader evaluates this file as an ES module.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright configuration for the Wombat web app.
 *
 * Two projects run every spec: chromium-light and chromium-dark.
 * Both share the same global setup (boots API + seeds demo content).
 *
 * Local vs CI:
 *   - Locally, set WOMBAT_TEST_DATABASE_URL to skip testcontainers overhead.
 *   - CI boots a Postgres service container and exports WOMBAT_TEST_DATABASE_URL.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  globalSetup: path.resolve(__dirname, "./tests/e2e/global-setup.ts"),

  projects: [
    {
      name: "chromium-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        storageState: "./tests/e2e/.auth/user.json",
      },
    },
    {
      name: "chromium-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        storageState: "./tests/e2e/.auth/user.json",
      },
    },
  ],

  webServer: process.env.CI
    ? {
        command: "pnpm preview",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
