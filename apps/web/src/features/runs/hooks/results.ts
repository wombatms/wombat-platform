/**
 * Result query + mutation hooks.
 *
 * Covers the full lifecycle of a run result row:
 * - useResults       — list with optional status filter
 * - useRecordResult  — single-item sugar over batch POST
 * - useRecordResultBatch — full batch POST
 * - useUpdateResult  — PUT with If-Match header (optimistic revision check)
 * - useClearResult   — DELETE a result row
 *
 * Error discipline: all mutations throw specialised ApiError subclasses via
 * mapRunError. A 409 result_conflict becomes ResultConflictError carrying
 * `currentRevision` — the caller (or the Task 41 wrapping hook) uses this to
 * surface the Reconcile banner. No silent invalidation on conflict.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { runKeys } from "../queryKeys";
import { mapRunError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ResultStatus = "pass" | "fail" | "blocked" | "skipped";

export interface BugLink {
  url: string;
  title?: string | null;
  note?: string | null;
}

/**
 * A single result row as returned by the API. The schema returns `unknown`
 * from the server so we define the shape we expect here.
 */
export interface ResultRow {
  id: string;
  run_id: string;
  case_id: string;
  status: ResultStatus;
  notes: string | null;
  failed_at_step: number | null;
  bug_links: BugLink[];
  duration_ms: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ResultListResponse {
  data: ResultRow[];
  pagination: { next_cursor: string | null };
}

export type RecordResultItem = components["schemas"]["RecordResultItem"];
export type PutResultRequest = components["schemas"]["PutResultRequest"];

export interface ResultListFilters {
  status?: string;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * List all result rows for a run, optionally filtered by status.
 * refetchOnWindowFocus enabled so the results panel stays live while the
 * runner tab is open.
 */
export function useResults(
  projectSlug: string,
  runId: string,
  filters: ResultListFilters = {},
) {
  return useQuery({
    queryKey: runKeys.results(projectSlug, runId, filters.status),
    queryFn: async (): Promise<ResultListResponse> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/runs/{run_id}/results",
        {
          params: {
            path: { project_slug: projectSlug, run_id: runId },
            query: filters.status ? { status: filters.status } : undefined,
          },
        },
      );
      if (error) throw error;
      return data as ResultListResponse;
    },
    enabled: Boolean(projectSlug && runId),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Record a batch of results in one request.
 * On success: invalidates the results subtree for the run.
 * On 409 result_conflict: throws ResultConflictError with currentRevision.
 */
export function useRecordResultBatch(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: RecordResultItem[]): Promise<ResultListResponse> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/runs/{run_id}/results",
          {
            params: { path: { project_slug: projectSlug, run_id: runId } },
            body: items as Parameters<typeof api.POST>[1]["body"],
          },
        );
        if (error) throw error;
        return data as ResultListResponse;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      // Invalidate all result views for this run (with or without status filter).
      void qc.invalidateQueries({ queryKey: runKeys.results(projectSlug, runId) });
    },
  });
}

/**
 * Record a single result — sugar over useRecordResultBatch for the common
 * single-case Runner flow.
 *
 * On 409 result_conflict this hook does NOT silently invalidate; it re-throws
 * as ResultConflictError so the caller (or Task 41's useRecordWithConflictHandling)
 * can expose the Reconcile banner with `currentRevision`.
 */
export function useRecordResult(projectSlug: string, runId: string) {
  const batch = useRecordResultBatch(projectSlug, runId);
  return useMutation({
    mutationFn: async (item: RecordResultItem): Promise<ResultRow | undefined> => {
      const response = await batch.mutateAsync([item]);
      const rows = response?.data ?? [];
      return rows.find((r) => r.case_id === item.case_id);
    },
  });
}

/**
 * PUT a single result with an If-Match revision check.
 * Sends `If-Match: <revision>` header so the server can detect concurrent
 * writes and return 409 result_conflict if the revision has advanced.
 *
 * On 409: throws ResultConflictError carrying the server's current_revision.
 * On success: invalidates the results subtree for the run.
 */
export function useUpdateResult(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      caseId: string;
      revision: number;
      body: PutResultRequest;
    }): Promise<ResultRow> => {
      try {
        const { data, error } = await api.PUT(
          "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}",
          {
            params: {
              path: { project_slug: projectSlug, run_id: runId, case_id: args.caseId },
              header: { "if-match": String(args.revision) },
            },
            body: args.body as Parameters<typeof api.PUT>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: ResultRow }).data;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.results(projectSlug, runId) });
    },
  });
}

/**
 * Delete a result row (clear / un-record a case result).
 * On success: invalidates the results subtree for the run.
 */
export function useClearResult(projectSlug: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (caseId: string): Promise<void> => {
      try {
        const { error } = await api.DELETE(
          "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}",
          {
            params: { path: { project_slug: projectSlug, run_id: runId, case_id: caseId } },
          },
        );
        if (error) throw error;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.results(projectSlug, runId) });
    },
  });
}
