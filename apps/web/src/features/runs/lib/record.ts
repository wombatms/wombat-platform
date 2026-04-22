/**
 * Optimistic concurrency helper for result recording.
 *
 * Wraps `useRecordResult` to orchestrate:
 *  1. Call the mutation (callers apply optimistic updates in the query cache
 *     themselves if desired, since the runner controls its own local state).
 *  2. On success: clear any pending reconcile state.
 *  3. On 409 `ResultConflictError`:
 *     a. Fetch the current result row for the affected case (the "theirs" value).
 *     b. Surface a `ReconcileState` object so the Runner UI can render a
 *        reconcile banner without silently applying the winning value.
 *
 * Invariant: `ReconcileState.kind` only transitions to `'conflict'` when the
 * server returns a well-formed `ResultConflictError`; all other errors are
 * re-thrown unchanged so the caller's error boundary can handle them.
 */

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { ResultConflictError } from "@/lib/api/errors";
import { runKeys } from "../queryKeys";
import { useRecordResult } from "../hooks/results";
import type { RecordResultItem, ResultRow, ResultListResponse } from "../hooks/results";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { RecordResultItem };

export type ReconcileState =
  | { kind: "idle" }
  | {
      kind: "conflict";
      /** The server's current result value (written by the other writer). */
      theirs: ResultRow;
      /** The payload this client attempted to write. */
      mine: RecordResultItem;
      /** The revision number the server reported as current. */
      currentRevision: number;
    };

// ---------------------------------------------------------------------------
// Internal helper: fetch the current result row for a given case from the API.
// Uses api.GET directly (not fetchQuery) so we get a fresh network response
// and can update the query cache as a side effect.
// ---------------------------------------------------------------------------

async function fetchCurrentResult(
  projectSlug: string,
  runId: string,
  caseId: string,
): Promise<ResultRow> {
  const { data, error } = await api.GET(
    "/api/projects/{project_slug}/runs/{run_id}/results",
    {
      params: {
        path: { project_slug: projectSlug, run_id: runId },
      },
    },
  );

  if (error) throw error;

  const list = data as ResultListResponse;
  const found = list.data.find((r) => r.case_id === caseId);

  if (!found) {
    // The row does not exist yet (race between conflict and deletion).
    // Construct a minimal sentinel so the UI can still render meaningfully.
    throw new Error(
      `fetchCurrentResult: no result row found for case ${caseId} in run ${runId}`,
    );
  }

  return found;
}

// ---------------------------------------------------------------------------
// useRecordWithConflictHandling
// ---------------------------------------------------------------------------

/**
 * Wraps `useRecordResult` with conflict-reconcile state management.
 *
 * Returns:
 * - `record(payload)` — call to attempt a write. Resolves on success,
 *   rejects on any error (including conflict — but also sets `reconcile`).
 * - `reconcile` — discriminated union `{ kind: 'idle' }` or
 *   `{ kind: 'conflict', theirs, mine, currentRevision }`.
 * - `clearReconcile()` — reset reconcile state to idle (e.g. user dismisses
 *   the banner without choosing a resolution).
 * - `mutation` — the underlying TanStack mutation object so callers can
 *   inspect `isPending`, `isError`, etc.
 *
 * Usage note: on conflict the hook both sets `reconcile` *and* re-throws
 * `ResultConflictError`. Callers that use `try/catch` around `record()` will
 * see the error; callers that ignore the promise can rely on `reconcile` alone.
 */
export function useRecordWithConflictHandling(
  projectSlug: string,
  runId: string,
) {
  const [reconcile, setReconcile] = useState<ReconcileState>({ kind: "idle" });
  const recordMutation = useRecordResult(projectSlug, runId);
  const queryClient = useQueryClient();

  const record = useCallback(
    async (payload: RecordResultItem): Promise<ResultRow | undefined> => {
      try {
        const response = await recordMutation.mutateAsync(payload);
        setReconcile({ kind: "idle" });
        return response;
      } catch (err) {
        if (err instanceof ResultConflictError) {
          // Fetch the other writer's value and update the results cache so the
          // list view reflects the latest server state.
          const theirs = await fetchCurrentResult(
            projectSlug,
            runId,
            payload.case_id,
          );

          // Refresh the query cache with the latest data.
          void queryClient.invalidateQueries({
            queryKey: runKeys.results(projectSlug, runId),
          });

          setReconcile({
            kind: "conflict",
            theirs,
            mine: payload,
            currentRevision: err.currentRevision,
          });
        }
        throw err;
      }
    },
    [recordMutation, projectSlug, runId, queryClient],
  );

  const clearReconcile = useCallback(() => {
    setReconcile({ kind: "idle" });
  }, []);

  return {
    record,
    reconcile,
    clearReconcile,
    mutation: recordMutation,
  };
}
