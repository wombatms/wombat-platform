import { useCallback, useEffect, useState } from "react";
import type { Density } from "@/components/shared/PageHeader";

const STORAGE_KEY = "wombat.density";

function readDensity(): Density {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "comfortable" || v === "compact") return v;
  } catch { /* */ }
  return "comfortable";
}

/**
 * useDensity — persisted comfortable/compact toggle.
 *
 * Returns [density, setDensity, toggleDensity].
 * The `d` keyboard shortcut is wired inside list pages (not here) to
 * avoid duplicate listeners. This hook is purely for read/write.
 */
export function useDensity(): [Density, (d: Density) => void, () => void] {
  const [density, setDensityState] = useState<Density>(readDensity);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* */ }
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(density === "comfortable" ? "compact" : "comfortable");
  }, [density, setDensity]);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "comfortable" || e.newValue === "compact")) {
        setDensityState(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return [density, setDensity, toggleDensity];
}
