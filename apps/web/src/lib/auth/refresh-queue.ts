import { setTokens, getRefreshToken, clearTokens } from "./storage";

let inflight: Promise<string> | null = null;

export async function refreshTokens(): Promise<string> {
  if (inflight) return inflight;
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("no refresh token");
  inflight = (async () => {
    try {
      const base = import.meta.env.VITE_API_BASE_URL ?? "";
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        clearTokens();
        throw new Error(`refresh failed: ${res.status}`);
      }
      const body = (await res.json()) as { access_token: string; refresh_token: string };
      setTokens(body);
      return body.access_token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
