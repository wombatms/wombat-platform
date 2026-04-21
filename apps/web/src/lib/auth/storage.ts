const AK = "wombat.access";
const RK = "wombat.refresh";

export type TokenPair = { access_token: string; refresh_token: string };

export function setTokens(p: TokenPair) {
  localStorage.setItem(AK, p.access_token);
  localStorage.setItem(RK, p.refresh_token);
}

export function clearTokens() {
  localStorage.removeItem(AK);
  localStorage.removeItem(RK);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(AK);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(RK);
}
