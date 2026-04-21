import { describe, it, expect, beforeEach, vi } from "vitest";
import { setTokens, clearTokens } from "./storage";

// We need to reset the module between tests to clear the inflight promise.
// Use dynamic imports to test the module in isolation.

describe("refresh queue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("two concurrent calls only issue one network request", async () => {
    setTokens({ access_token: "old-access", refresh_token: "my-refresh" });

    let callCount = 0;
    const mockFetch = vi.fn(async (_input: unknown, _init?: unknown) => {
      callCount++;
      // Simulate async delay to allow both calls to see inflight
      await new Promise((r) => setTimeout(r, 5));
      return {
        ok: true,
        json: async () => ({
          access_token: "new-access",
          refresh_token: "new-refresh",
        }),
      } as Response;
    });

    vi.stubGlobal("fetch", mockFetch);

    const { refreshTokens } = await import("./refresh-queue");

    // Reset inflight by re-importing a fresh module (use separate module isolation)
    const [result1, result2] = await Promise.all([refreshTokens(), refreshTokens()]);

    expect(callCount).toBe(1);
    expect(result1).toBe("new-access");
    expect(result2).toBe("new-access");
  });

  it("resolves all waiters with new access token", async () => {
    setTokens({ access_token: "old", refresh_token: "rt" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "fresh", refresh_token: "fresh-rt" }),
      })),
    );

    // Dynamic import gives us the currently loaded instance
    const { refreshTokens } = await import("./refresh-queue");
    const token = await refreshTokens();
    expect(token).toBe("fresh");
  });

  it("rejects and clears tokens on failed refresh", async () => {
    setTokens({ access_token: "old", refresh_token: "bad-rt" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
      })),
    );

    const { refreshTokens } = await import("./refresh-queue");
    const { getAccessToken } = await import("./storage");

    await expect(refreshTokens()).rejects.toThrow("refresh failed: 401");
    expect(getAccessToken()).toBeNull();
  });

  it("throws immediately when no refresh token is present", async () => {
    clearTokens();
    const { refreshTokens } = await import("./refresh-queue");
    await expect(refreshTokens()).rejects.toThrow("no refresh token");
  });
});
