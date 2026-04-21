import { describe, it, expect, beforeEach } from "vitest";
import { getAccessToken, setTokens, clearTokens, getRefreshToken } from "./storage";

describe("auth storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips access + refresh tokens", () => {
    setTokens({ access_token: "a.b.c", refresh_token: "r.s.t" });
    expect(getAccessToken()).toBe("a.b.c");
    expect(getRefreshToken()).toBe("r.s.t");
  });

  it("clears tokens", () => {
    setTokens({ access_token: "x", refresh_token: "y" });
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
