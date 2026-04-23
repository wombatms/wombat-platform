/**
 * Tests for useResolveDraft (SP3.4 Task 34).
 *
 * Coverage:
 *  1. Not fetching immediately on mount (debounce has not elapsed).
 *  2. Happy path: data resolves after 250 ms debounce window elapses.
 *  3. Debounce coalescing: rapid changes within 250 ms produce exactly one fetch.
 *  4. AbortController: stale in-flight requests are cancelled when the query
 *     key changes; no data is written to the cache for the stale key.
 *  5. Disabled when body is empty — no fetch fires.
 *  6. Disabled when slug is empty.
 *  7. Stable-hash: semantically equivalent objects (different key order)
 *     share the same cache entry and do not trigger a second fetch.
 *
 * Fake-timer strategy:
 *   vi.useFakeTimers({ shouldAdvanceTime: true }) — real time continues to
 *   advance so Promise micro-tasks and MSW async handlers still resolve.
 *   Explicit `vi.advanceTimersByTime(N)` fast-forwards setTimeout/setInterval
 *   N ms without waiting wall-clock time.  Timers are always restored in
 *   afterEach to prevent leakage across tests.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { useResolveDraft } from "./use-resolve-draft";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = "alpha";

const FIXTURE_RESOLVED_PLAN = {
  kind: "plan",
  title: "Smoke Tests",
  cases: [{ wombat_id: "TC-001", title: "Login" }],
};

const FIXTURE_RESOLVED_SUITE = {
  kind: "suite",
  title: "Suite A",
  cases: [{ wombat_id: "TC-002", title: "Logout" }],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Disable garbage collection so we can inspect cache entries post-fetch.
        gcTime: Infinity,
      },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return QueryClientProvider({ client: qc, children });
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Provide a valid auth token so the middleware doesn't 401.
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");

  server.use(
    http.post("*/api/projects/:project_slug/content/resolve", async ({ request }) => {
      const body = (await request.json()) as { kind: string };
      const fixture = body.kind === "suite" ? FIXTURE_RESOLVED_SUITE : FIXTURE_RESOLVED_PLAN;
      return HttpResponse.json(fixture);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Not fetching immediately on mount
// ---------------------------------------------------------------------------

describe("useResolveDraft — initial state", () => {
  it("does not fetch immediately on mount — waits for debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const qc = makeQC();
    const body = { include: ["TC-001"], title: "Smoke Tests" };

    const { result } = renderHook(() => useResolveDraft(SLUG, "plan", body), {
      wrapper: wrapper(qc),
    });

    // No time has elapsed — debounced body is still undefined → disabled.
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path
// ---------------------------------------------------------------------------

describe("useResolveDraft — happy path", () => {
  it("returns resolved data for kind='plan' after the debounce window elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const qc = makeQC();
    const body = { include: ["TC-001"], title: "Smoke Tests" };

    const { result } = renderHook(() => useResolveDraft(SLUG, "plan", body), {
      wrapper: wrapper(qc),
    });

    // Advance past the 250 ms debounce — debouncedBody becomes defined.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_RESOLVED_PLAN);
  });

  it("returns resolved data for kind='suite'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const qc = makeQC();
    const body = { include: ["TC-002"] };

    const { result } = renderHook(() => useResolveDraft(SLUG, "suite", body), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_RESOLVED_SUITE);
  });
});

// ---------------------------------------------------------------------------
// 3. Debounce coalescing
// ---------------------------------------------------------------------------

describe("useResolveDraft — debounce coalescing", () => {
  it("fires exactly one fetch for rapid body changes within a single 250ms window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let fetchCount = 0;
    server.use(
      http.post("*/api/projects/:project_slug/content/resolve", async () => {
        fetchCount += 1;
        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      }),
    );

    const qc = makeQC();

    const { rerender } = renderHook(
      ({ body }: { body: { v: number } }) => useResolveDraft(SLUG, "plan", body),
      {
        initialProps: { body: { v: 1 } },
        wrapper: wrapper(qc),
      },
    );

    // Simulate 5 rapid re-renders at 30 ms intervals (total 150 ms < 250 ms).
    // Each rerender resets the debounce timer.
    for (let i = 2; i <= 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(30);
        rerender({ body: { v: i } });
      });
    }

    // 150 ms elapsed total — no debounce has settled, no fetch should have fired.
    expect(fetchCount).toBe(0);

    // Advance past the debounce window for the last body value.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Wait for the single coalesced fetch to complete.
    await waitFor(() => expect(fetchCount).toBe(1));
  });
});

// ---------------------------------------------------------------------------
// 4. AbortController cancellation
//
// Strategy: the MSW handler for the first request stalls for 80 ms to give
// TanStack Query time to cancel it when the second query key is queued.
// We verify that the abort event fires on the first request's signal and
// that no data is written to the first request's cache key.
// ---------------------------------------------------------------------------

describe("useResolveDraft — AbortController cancellation", () => {
  it("aborts the stale in-flight request when the query key changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let firstRequestAbortFired = false;

    server.use(
      http.post("*/api/projects/:project_slug/content/resolve", async ({ request }) => {
        const reqBody = (await request.json()) as { body: { v: string } };
        const v = reqBody.body?.v ?? "other";

        if (v === "first") {
          // Stall for 80 ms so TanStack Query can cancel the query.
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 80);
            request.signal.addEventListener("abort", () => {
              firstRequestAbortFired = true;
              clearTimeout(t);
              resolve();
            });
          });

          if (request.signal.aborted) {
            return HttpResponse.error();
          }
        }

        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      }),
    );

    const qc = makeQC();

    const { rerender } = renderHook(
      ({ body }: { body: { v: string } }) => useResolveDraft(SLUG, "plan", body),
      {
        initialProps: { body: { v: "first" } },
        wrapper: wrapper(qc),
      },
    );

    // Let the first debounce elapse so the first fetch starts.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Immediately switch body — new query key is queued, first query cancelled.
    await act(async () => {
      rerender({ body: { v: "second" } });
    });

    // Advance another 300 ms for the second debounce and the stall to complete.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Wait for the abort event to have fired.
    await waitFor(() => expect(firstRequestAbortFired).toBe(true), { timeout: 3000 });

    // The cache for the first query key must have no data (the aborted request
    // was discarded and the cache entry was never populated).
    const firstHash = JSON.stringify({ v: JSON.stringify("first") });
    const firstKey = ["content-resolve", SLUG, "plan", firstHash];
    const staleState = qc.getQueryState(firstKey);
    expect(staleState?.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. Disabled states
// ---------------------------------------------------------------------------

describe("useResolveDraft — disabled states", () => {
  it("does not fetch when body is an empty object", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let fetchCount = 0;
    server.use(
      http.post("*/api/projects/:project_slug/content/resolve", () => {
        fetchCount += 1;
        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useResolveDraft(SLUG, "plan", {}), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetchCount).toBe(0);
  });

  it("does not fetch when slug is empty", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let fetchCount = 0;
    server.use(
      http.post("*/api/projects/:project_slug/content/resolve", () => {
        fetchCount += 1;
        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      }),
    );

    const qc = makeQC();
    const body = { include: ["TC-001"] };
    const { result } = renderHook(() => useResolveDraft("", "plan", body), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetchCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Stable-hash: same keys in different order → single cache entry
// ---------------------------------------------------------------------------

describe("useResolveDraft — stable hash", () => {
  it("does not re-fetch when body has the same keys in a different order", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let fetchCount = 0;
    server.use(
      http.post("*/api/projects/:project_slug/content/resolve", () => {
        fetchCount += 1;
        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      }),
    );

    const qc = makeQC();
    const bodyA = { b: 2, a: 1 };
    const bodyB = { a: 1, b: 2 }; // same semantics, different key order

    const { rerender } = renderHook(
      ({ body }: { body: { a: number; b: number } }) =>
        useResolveDraft(SLUG, "plan", body),
      {
        initialProps: { body: bodyA },
        wrapper: wrapper(qc),
      },
    );

    // Let the first debounce elapse and the first fetch complete.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(fetchCount).toBe(1));

    // Switch to bodyB (same content, different ordering).
    rerender({ body: bodyB });

    // Advance past another debounce window — no new fetch should fire.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Still exactly one fetch.
    expect(fetchCount).toBe(1);
  });
});
