/**
 * Run events hook — paginated audit log for a run.
 *
 * Uses useInfiniteQuery with cursor-based pagination so the Runner's event
 * panel can load more history without re-fetching earlier pages.
 *
 * Key: runKeys.events(projectSlug, runId) — prefix-extends runKeys.detail
 * so removeQueries on a run detail cleans up the event log too.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { runKeys } from "../queryKeys";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RunEvent {
  id: string;
  run_id: string;
  action: string;
  user_id: string | null;
  token_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface RunEventsPage {
  events: RunEvent[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

/**
 * Paginated audit log for a run.
 *
 * - Uses cursor-based `useInfiniteQuery`; call `fetchNextPage()` to load more.
 * - `hasNextPage` is true while `next_cursor` is non-null.
 * - `refetchOnWindowFocus: false` — the log is append-only and large pages are
 *   expensive; consumers call `refetch()` manually when they need fresh data.
 */
export function useRunEvents(projectSlug: string, runId: string) {
  return useInfiniteQuery({
    queryKey: runKeys.events(projectSlug, runId),
    queryFn: async ({ pageParam }): Promise<RunEventsPage> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/runs/{run_id}/events",
        {
          params: {
            path: { project_slug: projectSlug, run_id: runId },
            query: {
              limit: 50,
              ...(typeof pageParam === "string" && pageParam
                ? { cursor: pageParam }
                : {}),
            },
          },
        },
      );
      if (error) throw error;
      return data as RunEventsPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: RunEventsPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(projectSlug && runId),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
