/**
 * Dashboard widget query hooks.
 *
 * Endpoints:
 *   GET /api/projects/{slug}/dashboards/widgets          → WidgetMeta[]
 *   GET /api/projects/{slug}/dashboards/widget/{widget}  → widget-specific JSON
 *
 * Query keys come from dashboardKeys in @/lib/query/keys (the SP3.4-canonical
 * location is @/api/query-keys — import from there once Task 31 lands it).
 *
 * TODO(SP3.4 Task 31): switch import to `@/api/query-keys` when available.
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { dashboardKeys } from "@/lib/query/keys";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Metadata for a single registered dashboard widget. */
export interface WidgetMeta {
  /** URL-safe identifier, e.g. "passfail_trend". */
  slug: string;
  /** Human-readable label, e.g. "Pass / fail trend". */
  title: string;
  /** Which scope kinds this widget supports. */
  scope_kinds: Array<"project" | "plan">;
  /**
   * Filter keys that MUST be present when scope is "project".
   * e.g. ["plan_id"] for release_readiness.
   */
  requires: string[];
}

export interface WidgetMetaResponse {
  widgets: WidgetMeta[];
}

/**
 * Discriminated union for the widget scope.
 *
 * - `{kind: "project", projectId: string}` — project-scoped widget; maps to
 *   `scope=project&scope_id=<projectId>` in the query string.
 * - `{kind: "plan", planWombatId: string}` — plan-scoped widget; maps to
 *   `scope=plan&scope_id=<planWombatId>` in the query string.
 */
export type Scope =
  | { kind: "project"; projectId: string }
  | { kind: "plan"; planWombatId: string };

/** Optional filter parameters passed alongside the scope. */
export interface Filters {
  /** Time window for trend widgets. Defaults to "30d" on the server. */
  window?: "7d" | "30d" | "90d" | "all";
  /** Restrict results to a specific environment UUID. */
  env_id?: string;
  /**
   * Required by release_readiness when scope=project — the plan wombat_id to
   * check release readiness against. The server returns 400 if missing.
   * Typed as WidgetMissingFilterError once Task 36 lands; surfaces as a generic
   * ApiError in the interim (the hook does NOT suppress the error).
   *
   * TODO(SP3.4 Task 36): import WidgetMissingFilterError and handle the typed 400.
   */
  plan_id?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive the `scope_id` query param value from a Scope. */
function scopeId(scope: Scope): string {
  return scope.kind === "project" ? scope.projectId : scope.planWombatId;
}

// ---------------------------------------------------------------------------
// useWidgetMeta
// ---------------------------------------------------------------------------

/**
 * Fetch the list of registered dashboard widgets for a project.
 *
 * Returns the `widgets` array so callers can render a registry of components
 * without knowing widget slugs statically.
 *
 * The result is intentionally long-lived (staleTime 5 min) because widget
 * metadata changes only on API deployments.
 */
export function useWidgetMeta(slug: string) {
  return useQuery({
    queryKey: dashboardKeys.meta(slug),
    queryFn: async (): Promise<WidgetMeta[]> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/dashboards/widgets",
        {
          params: { path: { project_slug: slug } },
        },
      );
      if (error) throw error;
      return (data as WidgetMetaResponse).widgets;
    },
    enabled: Boolean(slug),
    staleTime: 5 * 60_000, // 5 min — meta rarely changes between API deploys
  });
}

// ---------------------------------------------------------------------------
// useWidget
// ---------------------------------------------------------------------------

/**
 * Fetch the data for a single dashboard widget.
 *
 * Returns a plain `Record<string, unknown>` because each widget has a
 * different response shape; the UI layer narrows via the frontend registry.
 *
 * Behaviour notes:
 * - `placeholderData: keepPreviousData` — filter changes keep the old data
 *   visible until the new fetch resolves (back-forward nav stays populated).
 * - No `enabled` guard based on required filters. The server validates and
 *   returns 400 if a required filter is missing; the hook surfaces that error
 *   as a thrown ApiError (or WidgetMissingFilterError once Task 36 lands).
 * - `refetchOnWindowFocus: true` — widgets show live aggregate data.
 *
 * @param slug        Project slug.
 * @param widget      Widget slug, e.g. "passfail_trend".
 * @param scope       Discriminated Scope union.
 * @param filters     Optional filter params (window, env_id, plan_id).
 */
export function useWidget(
  slug: string,
  widget: string,
  scope: Scope,
  filters: Filters = {},
) {
  const sid = scopeId(scope);

  return useQuery({
    queryKey: dashboardKeys.widget(slug, widget, scope.kind, sid, filters),
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/dashboards/widget/{slug}",
        {
          params: {
            path: { project_slug: slug, slug: widget },
            query: {
              scope: scope.kind,
              scope_id: sid,
              ...(filters.window !== undefined ? { window: filters.window } : {}),
              ...(filters.env_id !== undefined ? { env_id: filters.env_id } : {}),
              ...(filters.plan_id !== undefined ? { plan_id: filters.plan_id } : {}),
            },
          },
        },
      );
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: Boolean(slug && widget),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
}
