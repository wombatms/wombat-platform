/**
 * URL-driven filter state for the dashboard pages (SP3.4 Task 50).
 *
 * Reads `window` / `env_id` / `plan_id` from URL search params and provides
 * a stable `Filters` object that widgets key their queries on.
 *
 * Default `window` is "30d" — matches the server-side default so the first
 * load does not trigger a re-fetch after hydration.
 *
 * Usage:
 *   const { filters, setFilters } = useFiltersFromUrl()
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Filters } from "./hooks";

type WindowValue = NonNullable<Filters["window"]>;
const VALID_WINDOWS: WindowValue[] = ["7d", "30d", "90d", "all"];

function isValidWindow(v: string | null): v is WindowValue {
  return VALID_WINDOWS.includes(v as WindowValue);
}

export interface DashboardFilters extends Required<Omit<Filters, "env_id" | "plan_id">> {
  env_id?: string;
  plan_id?: string;
}

export interface UseFiltersFromUrlReturn {
  filters: DashboardFilters;
  setFilters: (partial: Partial<DashboardFilters>) => void;
}

/**
 * Read dashboard filter state from URL search params.
 * Writing via `setFilters` merges into the current params — existing unrelated
 * params (e.g. from the router) are preserved.
 *
 * `filters` is memoised on the raw search param values to produce a stable
 * object reference across renders (prevents the useCallback dep from changing
 * on every render when nothing actually changed).
 */
export function useFiltersFromUrl(): UseFiltersFromUrlReturn {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawWindow = searchParams.get("window");
  const rawEnvId = searchParams.get("env_id");
  const rawPlanId = searchParams.get("plan_id");

  const filters = useMemo<DashboardFilters>(
    () => ({
      window: isValidWindow(rawWindow) ? rawWindow : "30d",
      ...(rawEnvId ? { env_id: rawEnvId } : {}),
      ...(rawPlanId ? { plan_id: rawPlanId } : {}),
    }),
    [rawWindow, rawEnvId, rawPlanId],
  );

  const setFilters = useCallback(
    (partial: Partial<DashboardFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged: Partial<DashboardFilters> = { ...filters, ...partial };
          // window is always present (has a default)
          if (merged.window) next.set("window", merged.window);
          // optional keys: set if present, delete if undefined/null
          if (merged.env_id) {
            next.set("env_id", merged.env_id);
          } else {
            next.delete("env_id");
          }
          if (merged.plan_id) {
            next.set("plan_id", merged.plan_id);
          } else {
            next.delete("plan_id");
          }
          return next;
        },
        { replace: true },
      );
    },
    [filters, setSearchParams],
  );

  return { filters, setFilters };
}
