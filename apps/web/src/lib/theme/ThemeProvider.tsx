import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";

export interface ThemeContextValue {
  mode: ThemeMode;
  applied: AppliedTheme;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "wombat.theme";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

function resolveApplied(mode: ThemeMode): AppliedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function writeDomTheme(applied: AppliedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", applied);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [applied, setApplied] = useState<AppliedTheme>(() => resolveApplied(readStoredMode()));

  // React to explicit mode changes.
  useEffect(() => {
    const next = resolveApplied(mode);
    setApplied(next);
    writeDomTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // Track system preference while in system mode.
  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: AppliedTheme = media.matches ? "dark" : "light";
      setApplied(next);
      writeDomTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, applied, setMode }),
    [mode, applied, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
