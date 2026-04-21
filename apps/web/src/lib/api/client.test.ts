import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTokens, getAccessToken } from "@/lib/auth/storage";

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

    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (input: URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      fetchCalls.push(url);

      if (url.includes("/api/auth/refresh")) {
        return new Response(
          JSON.stringify({ access_token: "fresh-token", refresh_token: "new-refresh" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // First call to /api/auth/me returns 401; second (retry) returns 200
      if (fetchCalls.filter((u) => u.includes("/api/auth/me")).length === 1) {
        return new Response(
          JSON.stringify({
            error: { code: "unauthorized", message: "Unauthorized", field: null, hint: null },
          }),
          { status: 401, statusText: "Unauthorized", headers: { "Content-Type": "application/json" } },
        );
      }

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
    // 1 original (401 /me) + 1 refresh + 1 retry = 3
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls.filter((u) => u.includes("/api/auth/refresh"))).toHaveLength(1);
    expect(getAccessToken()).toBe("fresh-token");
  });

  it("throws ApiError(401) when refresh itself fails", async () => {
    setTokens({ access_token: "stale", refresh_token: "bad-refresh" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | Request) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes("/api/auth/refresh")) {
          return new Response(JSON.stringify({}), { status: 401, statusText: "Unauthorized" });
        }
        return new Response(
          JSON.stringify({
            error: { code: "unauthorized", message: "Unauthorized", field: null, hint: null },
          }),
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
