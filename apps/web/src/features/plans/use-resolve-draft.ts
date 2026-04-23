/**
 * useResolveDraft — debounced draft-preview hook for plan/suite content.
 *
 * Design invariants (SP3.4):
 * - 250 ms debounce + AbortController: rapid edits coalesce to one fetch;
 *   stale in-flight requests are cancelled when the query key changes.
 * - Stable-hash via sorted-keys JSON stringify: semantically equivalent
 *   objects produce the same cache key without repeated fetches.
 * - keepPreviousData (placeholderData) keeps the preview pane populated
 *   while a re-fetch is in flight.
 * - Never surfaces raw Response — errors flow through ApiError.
 */

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { resolveKeys } from "@/lib/query/keys";

// ---------------------------------------------------------------------------
// Minimal useDebounce — avoids pulling an external library for 5 lines.
//
// Important: the initial debounced value is `undefined` (not the initial
// `value`) so that the very first render does NOT immediately fire a fetch.
// The caller must wait 250 ms after mount before any query is enabled.
// This matches the UX intent: the preview only resolves after the user has
// paused typing for 250 ms, not on the instant the form first mounts.
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delayMs: number): T | undefined {
  const [debounced, setDebounced] = useState<T | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Stable-hash helper
//
// Serialises an object to JSON with keys sorted at every nesting level so
// that `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }` produce the same string.
// This string is used as the `hash` segment of the TanStack Query key, which
// means semantically equivalent bodies share a cache entry and do not trigger
// an extra fetch when React re-renders with a structurally different but
// semantically identical object.
// ---------------------------------------------------------------------------

function stableHash(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = stableHash(obj[k]);
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// ---------------------------------------------------------------------------
// ResolvedContent — the API returns `unknown`; callers narrow as needed.
// ---------------------------------------------------------------------------

export type ResolvedContent = unknown;

// ---------------------------------------------------------------------------
// useResolveDraft
//
// @param slug    Project slug (URL param).
// @param kind    "plan" | "suite" — discriminates the server-side resolver.
// @param body    Unsaved draft body object (updated on every keystroke).
//
// Returns a standard TanStack Query result.  `data` is the resolved content
// once the debounce window closes and the fetch completes.
// ---------------------------------------------------------------------------

export function useResolveDraft(slug: string, kind: "plan" | "suite", body: object) {
  // 1. Debounce the body reference so the effective value only changes
  //    250 ms after the caller last updated it.  The initial value is
  //    `undefined` — no fetch fires on mount; only after the first
  //    debounce window elapses.
  const debouncedBody = useDebounce(body, 250);

  // 2. Stable-hash for the query key — two equal-but-not-identical objects
  //    must not produce two separate cache entries.  Fall back to an empty
  //    string while still debouncing (debouncedBody === undefined).
  const hash = debouncedBody !== undefined ? stableHash(debouncedBody) : "";

  // 3. Guard: enabled only when the slug is set, the debounce window has
  //    elapsed (debouncedBody is defined), and the resolved body is
  //    non-empty (avoids fetching with an uninitialised form).
  const isBodyNonEmpty =
    debouncedBody !== undefined &&
    typeof debouncedBody === "object" &&
    debouncedBody !== null &&
    Object.keys(debouncedBody).length > 0;

  return useQuery<ResolvedContent>({
    queryKey: resolveKeys.draft(slug, kind, hash),

    queryFn: async ({ signal }): Promise<ResolvedContent> => {
      // openapi-fetch accepts a `signal` option and forwards it to the
      // underlying fetch() call, enabling AbortController cancellation
      // whenever the query key changes before the response arrives.
      const { data, error } = await api.POST(
        "/api/projects/{project_slug}/content/resolve",
        {
          params: { path: { project_slug: slug } },
          body: {
            kind,
            body: debouncedBody as { [key: string]: unknown },
          },
          signal,
        },
      );

      if (error) throw error;
      return data as ResolvedContent;
    },

    enabled: Boolean(slug) && isBodyNonEmpty,

    // Keep the previous resolved result visible in the preview pane while
    // a new fetch is in flight — avoids a blank flash on every keystroke.
    placeholderData: keepPreviousData,
  });
}
