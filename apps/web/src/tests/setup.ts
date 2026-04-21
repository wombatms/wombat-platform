import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";

// Ensure the API client uses an absolute base URL so that openapi-fetch
// can construct valid URLs in Node.js (MSW intercepts http://localhost:8000/*).
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

// jsdom does not implement ResizeObserver (used by cmdk and TanStack Virtual).
// Provide a no-op shim so components that use it don't throw.
if (typeof ResizeObserver === "undefined") {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement Element.scrollIntoView (used by cmdk list highlight).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Suppress React Router v6 → v7 future-flag deprecation warnings in tests.
const _warn = console.warn.bind(console);
console.warn = (msg: unknown, ...args: unknown[]) => {
  if (typeof msg === "string" && msg.includes("React Router Future Flag")) return;
  _warn(msg, ...args);
};

// Start MSW immediately (not in beforeAll) so that globalThis.fetch is
// patched before any test file's static imports are evaluated.
// openapi-fetch captures globalThis.fetch at createClient() time — starting
// MSW here guarantees the interception wrapper is already in place.
server.listen({ onUnhandledRequest: "warn" });

beforeAll(() => {
  // Re-confirm the server is listening (idempotent — MSW guards against double-listen).
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
