import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTokens, clearTokens, getAccessToken } from "@/lib/auth/storage";

// openapi-fetch builds a full URL from baseUrl + path.
// In jsdom, VITE_API_BASE_URL is undefined so baseUrl="" which produces relative URLs.
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

describe("api client 401 retry", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");
  });

  it("retries once on 401, replaces stale token, returns final 200 response", async () => {
    setTokens({ access_token: "stale-token", refresh_token: "good-refresh" });

    // Track all fetch calls: openapi-fetch calls globalThis.fetch directly.
    // With middleware, the first call goes through the middleware chain via the built-in fetch,
    // the refresh uses global fetch, and the retry uses global fetch.
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      fetchCalls.push(url);

      if (url.includes("/api/auth/refresh")) {
        return new Response(
          JSON.stringify({ access_token: "fresh-token", refresh_token: "new-refresh" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // The middleware intercepts onResponse; openapi-fetch uses global fetch internally.
      // First call to /api/auth/me returns 401 — the middleware retries.
      if (fetchCalls.filter((u) => u.includes("/api/auth/me")).length === 1) {
        return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized", field: null, hint: null } }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        });
      }

      // Second call (retry) returns 200 with user data
      return new Response(
        JSON.stringify({
          id: "uuid",
          email: "test@example.com",
          display_name: "Test",
          is_active: true,
          created_at: "2024-01-01T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    vi.stubGlobal("fetch", mockFetch);

    const { api } = await import("./client");
    const res = await api.GET("/api/auth/me");

    expect(res.error).toBeUndefined();
    // Calls: 1 original (401 /me) + 1 refresh + 1 retry (/me again) = 3
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls.filter((u) => u.includes("/api/auth/refresh"))).toHaveLength(1);
    expect(getAccessToken()).toBe("fresh-token");
  });

  it("throws ApiError(401) when refresh itself fails", async () => {
    setTokens({ access_token: "stale", refresh_token: "bad-refresh" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (url.includes("/api/auth/refresh")) {
          return new Response(JSON.stringify({}), {
            status: 401,
            statusText: "Unauthorized",
          });
        }
        return new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "Unauthorized", field: null, hint: null } }),
          { status: 401, statusText: "Unauthorized", headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { api } = await import("./client");
    const { ApiError } = await import("./errors");

    await expect(api.GET("/api/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
  });
});
