/**
 * Run query + mutation hooks.
 *
 * All query hooks use `runKeys` for stable, hierarchical cache keys.
 * All mutation hooks throw specialised SP3.3 error subclasses via
 * `mapRunError` — never raw Response objects.
 *
 * Polling invariant: `useRun` polls every 30 s while the tab is visible,
 * and suspends polling while the tab is hidden. This satisfies the
 * SP3.3 requirement that polling never runs while `document.visibilityState`
 * is not `"visible"`.
 */

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { runKeys, type RunListFilters } from "../queryKeys";
import { mapRunError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  project_id: string;
  title: string;
  status: "open" | "closed";
  close_reason: "completed" | "aborted" | null;
  environment_id: string | null;
  assignee_user_ids: string[];
  assignee_token_ids: string[];
  source: string;
  created_by_user_id: string | null;
  created_by_token_id: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Progress counters — present on the detail view only */
  total_cases?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
  skipped?: number;
  not_run?: number;
}

export interface RunListPage {
  data: RunSummary[];
  next_cursor: string | null;
}

export interface RunCase {
  id: string;
  run_id: string;
  content_id: string;
  wombat_id: string;
  title: string;
  position: number;
}

export interface RunCasesResponse {
  data: RunCase[];
}

export interface CaseSelection {
  filter?: Record<string, unknown> | null;
  case_ids?: string[] | null;
}

export interface CreateRunBody {
  title: string;
  environment_id?: string | null;
  assignee_user_ids?: string[];
  assignee_token_ids?: string[];
  source?: string;
  case_selection: CaseSelection;
}

export interface PatchRunBody {
  title?: string | null;
  environment_id?: string | null;
  assignee_user_ids?: string[] | null;
  assignee_token_ids?: string[] | null;
}

export interface CloseRunBody {
  reason: "completed" | "aborted";
  note?: string | null;
}

export interface RerunBody {
  include_statuses?: string[] | null;
  case_ids?: string[] | null;
}

export interface AddCasesBody {
  case_selection: CaseSelection;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * Infinite-scrolling list of runs for a project.
 *
 * TanStack Query deduplicates page fetches by the page-param (cursor value).
 * The calling component drives pagination by calling `fetchNextPage()`.
 */
export function useRuns(projectSlug: string, filters: RunListFilters = {}) {
  return useInfiniteQuery<RunListPage, Error, InfiniteData<RunListPage>, ReturnType<typeof runKeys.list>, string | null>({
    queryKey: runKeys.list(projectSlug, filters),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/runs",
        {
          params: {
            path: { project_slug: projectSlug },
            query: {
              status: filters.status,
              environment_id: filters.environment_id,
              owner_id: filters.owner_id,
              q: filters.q,
              cursor: pageParam ?? undefined,
            },
          },
        },
      );
      if (error) throw error;
      return data as RunListPage;
    },
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(projectSlug),
    refetchOnWindowFocus: true,
  });
}

/**
 * Detail view for a single run.
 *
 * Polls every 30 s while the browser tab is focused. Suspends polling
 * while the tab is in the background to avoid unnecessary traffic.
 */
export function useRun(projectSlug: string, runId: string) {
  return useQuery({
    queryKey: runKeys.detail(projectSlug, runId),
    queryFn: async (): Promise<RunSummary> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/runs/{run_id}",
        {
          params: { path: { project_slug: projectSlug, run_id: runId } },
        },
      );
      if (error) throw error;
      return data as RunSummary;
    },
    enabled: Boolean(projectSlug && runId),
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 30_000 : false,
  });
}

/**
 * Ordered list of cases assigned to a run.
 *
 * Note: the generated schema.d.ts snapshot does not expose the GET method on
 * this path (it only captures the POST). The endpoint is live on the API per
 * §5 of the SP3.3 design spec. We cast to bypass the static type constraint
 * until the next schema regeneration picks up the GET operation.
 */
export function useRunCases(projectSlug: string, runId: string) {
  return useQuery({
    queryKey: runKeys.cases(projectSlug, runId),
    queryFn: async (): Promise<RunCase[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (api.GET as any)(
        "/api/projects/{project_slug}/runs/{run_id}/cases",
        {
          params: { path: { project_slug: projectSlug, run_id: runId } },
        },
      );
      if (error) throw error;
      const response = data as RunCasesResponse;
      return response.data;
    },
    enabled: Boolean(projectSlug && runId),
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new run in the project.
 * Invalidates the run list on success and returns the created run.
 */
export function useCreateRun(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateRunBody): Promise<RunSummary> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs",
          {
            params: { path: { project_slug: projectSlug } },
            body: {
              title: body.title,
              environment_id: body.environment_id ?? null,
              assignee_user_ids: body.assignee_user_ids ?? [],
              assignee_token_ids: body.assignee_token_ids ?? [],
              source: body.source ?? "manual",
              case_selection: body.case_selection,
            },
          },
        );
        if (error) throw error;
        return data as RunSummary;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.lists(projectSlug) });
    },
  });
}

/**
 * Optimistically update run metadata (title, env, assignees).
 *
 * The optimistic snapshot is applied immediately to the detail cache.
 * If the PATCH fails, the previous value is restored via `onError`.
 * On success the detail and list are invalidated to reflect the
 * server-confirmed state.
 */
export function useUpdateRun(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PatchRunBody): Promise<RunSummary> => {
      try {
        const { data, error } = await api.PATCH(
          "/api/projects/{project_slug}/runs/{run_id}",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
            body: body,
          },
        );
        if (error) throw error;
        return data as RunSummary;
      } catch (err) {
        mapRunError(err);
      }
    },
    onMutate: async (variables) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update.
      await qc.cancelQueries({ queryKey: runKeys.detail(projectSlug, runId) });
      // Snapshot the previous value for rollback.
      const previous = qc.getQueryData<RunSummary>(runKeys.detail(projectSlug, runId));
      // Apply the optimistic patch.
      if (previous) {
        qc.setQueryData<RunSummary>(runKeys.detail(projectSlug, runId), {
          ...previous,
          ...(variables.title != null && { title: variables.title }),
          ...(variables.environment_id !== undefined && {
            environment_id: variables.environment_id,
          }),
          ...(variables.assignee_user_ids != null && {
            assignee_user_ids: variables.assignee_user_ids,
          }),
          ...(variables.assignee_token_ids != null && {
            assignee_token_ids: variables.assignee_token_ids,
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _variables, context) => {
      // Roll back to the snapshot captured in onMutate.
      if (context?.previous) {
        qc.setQueryData(runKeys.detail(projectSlug, runId), context.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.detail(projectSlug, runId) });
      void qc.invalidateQueries({ queryKey: runKeys.lists(projectSlug) });
    },
  });
}

/**
 * Close an open run (mark it completed or aborted).
 * Requires the caller to be an assignee or admin.
 * On 403 `run_not_open` → RunNotOpenError.
 * On 403 `unauthorized_run_action` → UnauthorizedRunActionError.
 * Invalidates detail + list on success.
 */
export function useCloseRun(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CloseRunBody): Promise<RunSummary> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs/{run_id}/close",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
            body: body,
          },
        );
        if (error) throw error;
        return data as RunSummary;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.detail(projectSlug, runId) });
      void qc.invalidateQueries({ queryKey: runKeys.lists(projectSlug) });
    },
  });
}

/**
 * Reopen a closed run (transitions it back to `open`).
 * Requires admin role (or `runs:reopen` permission on the API token).
 * On 403 `run_closed` is not applicable here — but `unauthorized_run_action`
 * and `run_not_open` (if already open) may be thrown.
 * Invalidates detail + list on success.
 */
export function useReopenRun(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RunSummary> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs/{run_id}/reopen",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
          },
        );
        if (error) throw error;
        return data as RunSummary;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.detail(projectSlug, runId) });
      void qc.invalidateQueries({ queryKey: runKeys.lists(projectSlug) });
    },
  });
}

/**
 * Spawn a new run from a subset of an existing run's cases.
 * Returns the newly created run (201).
 * Invalidates the run list so the new run appears in the project runs list.
 */
export function useRerun(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RerunBody): Promise<RunSummary> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs/{run_id}/reruns",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
            body: {
              include_statuses: body.include_statuses ?? null,
              case_ids: body.case_ids ?? null,
            },
          },
        );
        if (error) throw error;
        return data as RunSummary;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.lists(projectSlug) });
    },
  });
}

/**
 * Add cases to an existing open run.
 * On success: invalidates cases + detail so the updated case list and
 * progress counters reflect the new additions.
 * On 409 `run_closed` → RunClosedError.
 */
export function useAddRunCases(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddCasesBody): Promise<RunCase[]> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs/{run_id}/cases",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
            body: {
              case_selection: body.case_selection,
            },
          },
        );
        if (error) throw error;
        const response = data as RunCasesResponse;
        return response.data;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.cases(projectSlug, runId) });
      void qc.invalidateQueries({ queryKey: runKeys.detail(projectSlug, runId) });
    },
  });
}

/**
 * Remove a single case from an open run.
 * `runCaseId` is the junction-table row ID (not the content_id / wombat_id).
 * On success: invalidates cases + detail.
 * On 403 `run_closed` → RunClosedError.
 */
export function useRemoveRunCase(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runCaseId: string): Promise<void> => {
      try {
        const { error } = await api.DELETE(
          "/api/projects/{project_slug}/runs/{run_id}/cases/{run_case_id}",
          {
            params: {
              path: {
                project_slug: projectSlug,
                run_id: runId,
                run_case_id: runCaseId,
              },
            },
          },
        );
        if (error) throw error;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.cases(projectSlug, runId) });
      void qc.invalidateQueries({ queryKey: runKeys.detail(projectSlug, runId) });
    },
  });
}
