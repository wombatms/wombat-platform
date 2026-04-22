import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { useRunEvents, type RunEventsPage, type RunEvent } from "./events";
import { runKeys } from "../queryKeys";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
});

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const PROJECT = "alpha-project";
const RUN_ID = "run-abc-123";

function makeEvent(n: number): RunEvent {
  return {
    id: `event-${String(n).padStart(3, "0")}`,
    run_id: RUN_ID,
    action: n % 2 === 0 ? "result_recorded" : "run_opened",
    user_id: "00000000-0000-0000-0000-000000000001",
    token_id: null,
    detail: null,
    created_at: `2026-04-22T10:0${String(n % 10)}:00Z`,
  };
}

const PAGE_1_EVENTS = [makeEvent(1), makeEvent(2), makeEvent(3)];
const PAGE_2_EVENTS = [makeEvent(4), makeEvent(5)];

const FIXTURE_PAGE_1: RunEventsPage = {
  events: PAGE_1_EVENTS,
  next_cursor: "cursor-page-2",
};

const FIXTURE_PAGE_2: RunEventsPage = {
  events: PAGE_2_EVENTS,
  next_cursor: null,
};

// ---------------------------------------------------------------------------
// useRunEvents
// ---------------------------------------------------------------------------

describe("useRunEvents", () => {
  it("fetches the first page of events", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        if (!cursor) return HttpResponse.json(FIXTURE_PAGE_1);
        return HttpResponse.json(FIXTURE_PAGE_2);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstPage = result.current.data?.pages[0];
    expect(firstPage?.events).toHaveLength(3);
    expect(firstPage?.events[0]?.id).toBe("event-001");
    expect(firstPage?.next_cursor).toBe("cursor-page-2");
  });

  it("hasNextPage is true when next_cursor is non-null", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", () => {
        return HttpResponse.json(FIXTURE_PAGE_1);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
  });

  it("hasNextPage is false when next_cursor is null", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", () => {
        return HttpResponse.json(FIXTURE_PAGE_2);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("fetchNextPage appends page 2 events and sends cursor param", async () => {
    let capturedCursor: string | null = null;
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        if (cursor) {
          capturedCursor = cursor;
          return HttpResponse.json(FIXTURE_PAGE_2);
        }
        return HttpResponse.json(FIXTURE_PAGE_1);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    // Wait for page 1
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);

    // Fetch page 2
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(capturedCursor).toBe("cursor-page-2");

    const allEvents = result.current.data?.pages.flatMap((p) => p.events);
    expect(allEvents).toHaveLength(5);
    expect(allEvents?.[3]?.id).toBe("event-004");
  });

  it("is disabled when projectSlug or runId is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents("", RUN_ID), {
      wrapper: wrapper(qc),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("uses runKeys.events key so detail invalidation clears events", () => {
    // This is a structural test: verify that the events key prefix-extends the
    // detail key (documented in queryKeys.test.ts), ensuring that
    // removeQueries({ queryKey: runKeys.detail(slug, id) }) also clears events.
    const detail = runKeys.detail(PROJECT, RUN_ID);
    const events = runKeys.events(PROJECT, RUN_ID);
    expect(events.slice(0, detail.length)).toEqual(detail);
  });

  it("propagates API errors", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", () => {
        return HttpResponse.json(
          { error: { code: "not_found", message: "Run not found.", field: null, hint: null } },
          { status: 404 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });

  it("sends limit parameter in requests", async () => {
    let capturedLimit: string | null = null;
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", ({ request }) => {
        const url = new URL(request.url);
        capturedLimit = url.searchParams.get("limit");
        return HttpResponse.json(FIXTURE_PAGE_2);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedLimit).toBe("50");
  });

  it("does not refetch on window focus (refetchOnWindowFocus: false)", async () => {
    let fetchCount = 0;
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/events", () => {
        fetchCount++;
        return HttpResponse.json(FIXTURE_PAGE_2);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRunEvents(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const countAfterFirst = fetchCount;

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCount).toBe(countAfterFirst);
  });
});
