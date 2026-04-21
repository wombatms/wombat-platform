import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTokens, clearTokens, getAccessToken } from "@/lib/auth/storage";

// openapi-fetch builds a full URL from baseUrl + path.
// In jsdom, VITE_API_BASE_URL is undefined so baseUrl="" which produces relative URLs.
// We override the env to give it a valid origin so URL parsing succeeds.
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");

describe("api client 401 retry", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
    // Re-stub env after resetModules
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");
  });

  it("retries once on 401, replaces stale token, returns final 200 response", async () => {
    setTokens({ access_token: "stale-token", refresh_token: "good-refresh" });

    let callCount = 0;
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/auth/refresh")) {
        return new Response(
          JSON.stringify({ access_token: "fresh-token", refresh_token: "new-refresh" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      const authHeader =
        (init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : (init?.headers as Record<string, string> | undefined)?.["Authorization"]) ?? "";

      if (authHeader.includes("stale-token")) {
        const cloned = new Response(JSON.stringify({}), { status: 401, statusText: "Unauthorized" });
        return Object.assign(cloned, { clone: () => new Response(JSON.stringify({}), { status: 401 }) });
      }

      return new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", mockFetch);

    const { api } = await import("./client");
    const res = await api.GET("/api/auth/me");
    expect(res.error).toBeUndefined();
    // 1 original (401) + 1 refresh + 1 retry = 3
    expect(callCount).toBe(3);
    expect(getAccessToken()).toBe("fresh-token");
  });

  it("throws ApiError(401) when refresh itself fails", async () => {
    setTokens({ access_token: "stale", refresh_token: "bad-refresh" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/auth/refresh")) {
          return new Response(JSON.stringify({}), { status: 401, statusText: "Unauthorized" });
        }
        const body = new Response(JSON.stringify({}), {
          status: 401,
          statusText: "Unauthorized",
        });
        return Object.assign(body, { clone: () => new Response(JSON.stringify({}), { status: 401 }) });
      }),
    );

    const { api } = await import("./client");
    const { ApiError } = await import("./errors");

    await expect(api.GET("/api/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
  });
});
