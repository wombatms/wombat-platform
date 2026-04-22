/**
 * Hierarchical query keys for runs, environments, results, evidence, and events.
 *
 * Design invariant: every key for a sub-resource of a run detail begins with
 * the same 4-element prefix as `runKeys.detail(projectSlug, id)`. This means
 * a single `queryClient.removeQueries({ queryKey: runKeys.detail(slug, id) })`
 * invalidates cases, results, events, and the detail itself.
 *
 * Evidence keys are nested under results because evidence is always scoped to
 * a specific result row.
 */

export interface RunListFilters {
  status?: string;
  environment_id?: string;
  owner_id?: string;
  q?: string;
}

export const runKeys = {
  /** Matches the entire runs namespace — used for full cache eviction. */
  all: ["runs"] as const,

  /** Matches all lists for a project — useful for removeQueries on project switch. */
  lists: (projectSlug: string) => ["runs", projectSlug, "list"] as const,

  list: (projectSlug: string, filters?: RunListFilters) =>
    ["runs", projectSlug, "list", filters ?? {}] as const,

  /** 4-element prefix shared by all sub-resource keys below. */
  detail: (projectSlug: string, id: string) =>
    ["runs", projectSlug, "detail", id] as const,

  /** Prefix-extends detail — invalidated automatically by removeQueries on detail. */
  cases: (projectSlug: string, id: string) =>
    ["runs", projectSlug, "detail", id, "cases"] as const,

  /** Prefix-extends detail. `status` filters client-side; omit for all statuses. */
  results: (projectSlug: string, id: string, status?: string) =>
    ["runs", projectSlug, "detail", id, "results", status ?? null] as const,

  /** Evidence is scoped per result row — prefix-extends results. */
  evidence: (projectSlug: string, runId: string, resultId: string) =>
    ["runs", projectSlug, "detail", runId, "results", null, "evidence", resultId] as const,

  /** Prefix-extends detail. */
  events: (projectSlug: string, id: string) =>
    ["runs", projectSlug, "detail", id, "events"] as const,

  /**
   * Environments are project-scoped, not run-scoped, so they live under a
   * separate top-level namespace and are not invalidated by run detail removal.
   */
  environments: (projectSlug: string) =>
    ["environments", projectSlug] as const,
};
