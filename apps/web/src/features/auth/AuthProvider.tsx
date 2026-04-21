import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { clearTokens, getAccessToken, setTokens } from "@/lib/auth/storage";
import { refreshTokens } from "@/lib/auth/refresh-queue";

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  /**
   * Permissions grouped by project slug, computed server-side from role +
   * token publish_direct grant. Use usePermission(slug, perm) to query.
   * Example: { "alpha-project": ["content:propose", "content:publish_direct"] }
   */
  permissions_by_project: Record<string, string[]>;
}

export type SessionStatus = "loading" | "authed" | "anonymous";

export interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

// Pre-expiry refresh: attempt to refresh 60 seconds before a JWT expires.
// Parses the exp claim from the access token (base64-encoded payload).
function getTokenExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePreExpiryRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const expMs = getTokenExpMs(accessToken);
    if (!expMs) return;
    const now = Date.now();
    const delay = expMs - now - 60_000; // 60s before expiry
    if (delay <= 0) return;
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const newToken = await refreshTokens();
        schedulePreExpiryRefresh(newToken);
      } catch {
        clearTokens();
        setUser(null);
        setStatus("anonymous");
      }
    }, delay);
  }, []);

  const fetchMe = useCallback(async (): Promise<User | null> => {
    const { data, error } = await api.GET("/api/auth/me");
    if (error) return null;
    return data as User;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await fetchMe();
    if (u) {
      setUser(u);
      setStatus("authed");
    }
  }, [fetchMe]);

  // On mount: if access token present, validate via /me; else try refresh.
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const token = getAccessToken();
      if (token) {
        try {
          const u = await fetchMe();
          if (cancelled) return;
          if (u) {
            setUser(u);
            setStatus("authed");
            schedulePreExpiryRefresh(token);
            return;
          }
        } catch (err) {
          if (isApiError(err) && err.status === 401) {
            // fall through to refresh attempt
          } else {
            if (!cancelled) setStatus("anonymous");
            return;
          }
        }
        // /me returned 401 — try refresh
        try {
          const newToken = await refreshTokens();
          if (cancelled) return;
          const u = await fetchMe();
          if (cancelled) return;
          if (u) {
            setUser(u);
            setStatus("authed");
            schedulePreExpiryRefresh(newToken);
            return;
          }
        } catch {
          // refresh failed
        }
      }
      if (!cancelled) {
        clearTokens();
        setUser(null);
        setStatus("anonymous");
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [fetchMe, schedulePreExpiryRefresh]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await api.POST("/api/auth/login", {
        body: { email, password },
      });
      if (error) throw error;
      const tokens = data as { access_token: string; refresh_token: string };
      setTokens(tokens);
      const u = await fetchMe();
      if (!u) throw new Error("Could not fetch user after login");
      setUser(u);
      setStatus("authed");
      schedulePreExpiryRefresh(tokens.access_token);
    },
    [fetchMe, schedulePreExpiryRefresh],
  );

  const logout = useCallback(() => {
    clearTokens();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setUser(null);
    setStatus("anonymous");
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [navigate, queryClient]);

  return (
    <SessionContext.Provider value={{ status, user, login, logout, refreshUser }}>
      {children}
    </SessionContext.Provider>
  );
}
