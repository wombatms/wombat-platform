/**
 * Plans query + mutation hooks.
 *
 * Query hooks use `planKeys` for stable, hierarchical cache keys.
 * All hooks throw ApiError (or a subclass) — never raw Response objects.
 *
 * Decision — useStartRunDraft as mutation, not query:
 *   The endpoint is a POST that hydrates a run-create form draft. It does NOT
 *   create any server-side resource, but it is semantically a command ("give me
 *   a draft derived from this plan right now") rather than a cacheable resource.
 *   Modelling it as useMutation means:
 *     - The caller controls when the draft fetch fires (button press / form open).
 *     - There is no stale-data risk: the draft always reflects the plan at the
 *       moment the user clicks "Start Run".
 *     - The result is not written to the query cache (no stale draft popping up
 *       when the plan changes between visits).
 *   If the UI ever needs eager/cached draft loading (e.g. a preview pane that
 *   updates as the plan is edited), wrap it in a useQuery with `enabled: false`
 *   and call `refetch()` — that is a straightforward lift from this mutation.
 *
 * Key dependency — planKeys:
 *   Task 31 (running in parallel) owns `apps/web/src/api/query-keys.ts`.
 *   If that module does not exist yet, the local `planKeys` inline below is
 *   used. Wave 7 checkpoint will import from the canonical module and delete
 *   the local copy.
 *
 *   TODO(sp3.4 wave 7): replace local planKeys with:
 *     import { planKeys } from '@/api/query-keys'
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Local planKeys fallback (Task 31 parallel — see module docblock above)
// ---------------------------------------------------------------------------

export interface PlanListFilters {
  tag?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}

// TODO(sp3.4 wave 7): import from '@/api/query-keys' once Task 31 lands
export const planKeys = {
  /** Namespace root — prefix-matches all plan keys for a project. */
  all: (slug: string) => ["project", slug, "plans"] as const,

  /** List with filters — producing a new cache entry per distinct filter set. */
  list: (slug: string, filters: PlanListFilters = {}) =>
    ["project", slug, "plans", "list", filters] as const,

  /** Detail key — prefix of resolve / start-run keys for this plan. */
  detail: (slug: string, wid: string) =>
    ["project", slug, "plans", "detail", wid] as const,

  /**
   * Resolve key — nested under detail so that invalidating the detail key
   * also sweeps the resolved view in one removeQueries call.
   */
  resolve: (slug: string, wid: string) =>
    ["project", slug, "plans", "detail", wid, "resolve"] as const,
};

// ---------------------------------------------------------------------------
// Shared types (mirroring the backend schema)
// ---------------------------------------------------------------------------

/** A plan as returned by the list endpoint. */
export interface PlanSummary {
  wombat_id: string;
  title: string;
  kind: "plan";
  tags: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Full plan body as returned by the detail endpoint. */
export interface PlanDetail extends PlanSummary {
  body: {
    suite_refs?: string[];
    explicit_cases?: { add: string[]; remove: string[] };
    include?: Record<string, unknown>;
    exclude?: Record<string, unknown>;
    environments?: string[];
    assignees?: string[];
    approvals?: Record<string, unknown>;
  };
  source_path: string;
  project_id: string;
}

/** A single resolved test case reference within a plan or suite. */
export interface ResolvedCase {
  wombat_id: string;
  title: string;
  source_path: string;
  suite_path: string[];
}

/** Response from GET /plans/{wid}/resolve. */
export interface ResolvedPlan {
  plan_wombat_id: string;
  title: string;
  resolved_cases: ResolvedCase[];
  total: number;
  resolved_at: string;
}

/** Response from POST /plans/{wid}/start-run. */
export interface StartRunDraft {
  plan_wombat_id: string;
  title: string;
  environment_id: string | null;
  assignee_user_ids: string[];
  assignee_token_ids: string[];
  resolved_case_ids: string[];
  resolved_case_count: number;
}

/** Response from POST /plans/{wid}/clone (a proposal in open state). */
export interface ClonePlanResponse {
  proposal_id: string;
  new_wombat_id: string;
  title: string;
  status: "open";
}

/** Arguments accepted by useClonePlan. */
export interface ClonePlanArgs {
  /** The source plan's wombat_id. */
  wombat_id: string;
  /** Desired wombat_id for the cloned plan (must be unique within the project). */
  new_wombat_id: string;
  /** Optional override title; defaults to source plan title + " (copy)". */
  title?: string;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * List all plans for a project.
 *
 * Uses keepPreviousData so the UI does not flash on filter changes.
 * refetchOnWindowFocus follows the global QueryClient default (true for lists).
 */
export function usePlansList(slug: string, filters: PlanListFilters = {}) {
  return useQuery({
    queryKey: planKeys.list(slug, filters),
    queryFn: async (): Promise<PlanSummary[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.GET as any)(
        "/api/projects/{project_slug}/plans",
        {
          params: {
            path: { project_slug: slug },
            query: {
              tag: filters.tag,
              q: filters.q,
              limit: filters.limit,
              offset: filters.offset,
            },
          },
        },
      );
      if (error) throw error;
      // Backend returns { data: PlanSummary[] } or a plain array depending on
      // the serializer version. Normalise to an array.
      if (Array.isArray(data)) return data as PlanSummary[];
      const envelope = data as { data?: PlanSummary[] };
      return envelope.data ?? [];
    },
    enabled: Boolean(slug),
    placeholderData: keepPreviousData,
  });
}

/**
 * Single-plan detail view.
 *
 * refetchOnWindowFocus is intentionally left at the global default (true) —
 * plan detail changes infrequently and a stale plan could produce a wrong
 * start-run draft.
 */
export function usePlanDetail(slug: string, wid: string) {
  return useQuery({
    queryKey: planKeys.detail(slug, wid),
    queryFn: async (): Promise<PlanDetail> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.GET as any)(
        "/api/projects/{project_slug}/plans/{wombat_id}",
        {
          params: { path: { project_slug: slug, wombat_id: wid } },
        },
      );
      if (error) throw error;
      return data as PlanDetail;
    },
    enabled: Boolean(slug && wid),
  });
}

/**
 * Resolved plan — expands suite refs and applies include/exclude filters to
 * produce the final ordered list of test cases.
 *
 * This is a read-only GET (no draft body). Use useResolveDraft (Task 34) for
 * live draft previews while the plan body is being edited.
 *
 * Cache key is nested under planKeys.detail so a single
 * `queryClient.removeQueries({ queryKey: planKeys.detail(slug, wid) })`
 * invalidates both the plan body and its resolved view.
 */
export function useResolvePlan(slug: string, wid: string) {
  return useQuery({
    queryKey: planKeys.resolve(slug, wid),
    queryFn: async (): Promise<ResolvedPlan> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.GET as any)(
        "/api/projects/{project_slug}/plans/{wombat_id}/resolve",
        {
          params: { path: { project_slug: slug, wombat_id: wid } },
        },
      );
      if (error) throw error;
      return data as ResolvedPlan;
    },
    enabled: Boolean(slug && wid),
    // Plan resolution results are heavier — keep for the full gcTime but don't
    // background-refetch on every focus. The user can trigger a refresh via
    // the parent plan detail invalidation.
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Hydrate a run-create form draft from a plan.
 *
 * DECISION: modelled as a mutation (not a query) because:
 *  1. The user explicitly triggers the draft (clicking "Start Run" on a plan).
 *  2. The draft must always be fresh — it must not be served from a stale cache
 *     if the plan's resolved cases changed since the last visit.
 *  3. The response is not a resource the app navigates to; it's transient
 *     form pre-fill data.
 *
 * Usage:
 *   const { mutateAsync, data, isPending } = useStartRunDraft(slug, wid);
 *   const draft = await mutateAsync();
 */
export function useStartRunDraft(slug: string, wid: string) {
  return useMutation({
    mutationFn: async (): Promise<StartRunDraft> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.POST as any)(
        "/api/projects/{project_slug}/plans/{wombat_id}/start-run",
        {
          params: { path: { project_slug: slug, wombat_id: wid } },
        },
      );
      if (error) throw error;
      return data as StartRunDraft;
    },
  });
}

/**
 * Clone a plan into a new proposal.
 *
 * The clone endpoint creates a plan-kind proposal (open, pending review) whose
 * body is a deep copy of the source plan. The caller supplies:
 *   - `wombat_id`     — source plan's wombat_id
 *   - `new_wombat_id` — desired wombat_id for the clone
 *   - `title`         — optional; defaults to server-generated "<source> (copy)"
 *
 * On success, invalidates `planKeys.all(slug)` so the list refreshes and the
 * new pending proposal (visible via the proposals inbox) is reflected.
 */
export function useClonePlan(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ClonePlanArgs): Promise<ClonePlanResponse> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.POST as any)(
        "/api/projects/{project_slug}/plans/{wombat_id}/clone",
        {
          params: { path: { project_slug: slug, wombat_id: args.wombat_id } },
          body: {
            new_wombat_id: args.new_wombat_id,
            ...(args.title != null && { title: args.title }),
          },
        },
      );
      if (error) throw error;
      return data as ClonePlanResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: planKeys.all(slug) });
    },
  });
}
