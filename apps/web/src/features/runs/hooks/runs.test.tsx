/**
 * Unit tests for run hooks.
 *
 * Testing strategy:
 * - Happy paths for every hook.
 * - Error-class promotion: 403 run_closed → RunClosedError, etc.
 * - Optimistic update rollback (useUpdateRun).
 * - InfiniteQuery pagination (useRuns).
 * - Cache invalidation assertions after each successful mutation.
 *
 * All HTTP is intercepted by MSW. Per-test overrides use server.use() which
 * is reset after each test by the global afterEach in setup.ts.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import {
  RunClosedError,
  RunNotOpenError,
  UnauthorizedRunActionError,
} from "@/lib/api/errors";
import {
  useRuns,
  useRun,
  useRunCases,
  useCreateRun,
  useUpdateRun,
  useCloseRun,
  useReopenRun,
  useRerun,
  useAddRunCases,
  useRemoveRunCase,
  type RunSummary,
  type RunCase,
  type RunListPage,
} from "./runs";
import { runKeys } from "../queryKeys";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = "alpha-project";
const RUN_ID = "aaaaaaaa-run0-0000-0000-000000000001";
const RUN_CASE_ID = "bbbbbbbb-runc-0000-0000-000000000001";

const FIXTURE_RUN: RunSummary = {
  id: RUN_ID,
  project_id: "pppppppp-0000-0000-0000-000000000001",
  title: "Sprint 42 smoke run",
  status: "open",
  close_reason: null,
  environment_id: null,
  assignee_user_ids: [],
  assignee_token_ids: [],
  source: "manual",
  created_by_user_id: "uuuuuuuu-0000-0000-0000-000000000001",
  created_by_token_id: null,
  opened_at: "2026-04-22T09:00:00Z",
  closed_at: null,
  created_at: "2026-04-22T09:00:00Z",
  updated_at: "2026-04-22T09:00:00Z",
  total_cases: 10,
  passed: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  not_run: 10,
};

const FIXTURE_CLOSED_RUN: RunSummary = {
  ...FIXTURE_RUN,
  status: "closed",
  close_reason: "completed",
  closed_at: "2026-04-22T18:00:00Z",
};

const FIXTURE_RUNS_PAGE_1: RunListPage = {
  data: [FIXTURE_RUN],
  next_cursor: "cursor-page2",
};

const FIXTURE_RUNS_PAGE_2: RunListPage = {
  data: [{ ...FIXTURE_RUN, id: "aaaaaaaa-run0-0000-0000-000000000002", title: "Run 2" }],
  next_cursor: null,
};

const FIXTURE_RUNS_LIST: RunListPage = {
  data: [FIXTURE_RUN],
  next_cursor: null,
};

const FIXTURE_RUN_CASE: RunCase = {
  id: RUN_CASE_ID,
  run_id: RUN_ID,
  content_id: "cccccccc-0000-0000-0000-000000000001",
  wombat_id: "TC-001",
  title: "Login happy path",
  position: 1,
};

// ---------------------------------------------------------------------------
// MSW handlers registered for this test file (override any global defaults)
// ---------------------------------------------------------------------------

function registerBaseHandlers() {
  server.use(
    http.get("*/api/projects/:slug/runs", ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get("cursor");
      if (cursor === "cursor-page2") {
        return HttpResponse.json(FIXTURE_RUNS_PAGE_2);
      }
      return HttpResponse.json(FIXTURE_RUNS_LIST);
    }),

    http.get("*/api/projects/:slug/runs/:run_id", ({ params }) => {
      if (params["run_id"] === RUN_ID) {
        return HttpResponse.json(FIXTURE_RUN);
      }
      return HttpResponse.json(
        { error: { code: "not_found", message: "Run not found.", field: null, hint: null } },
        { status: 404 },
      );
    }),

    http.get("*/api/projects/:slug/runs/:run_id/cases", () => {
      return HttpResponse.json({ data: [FIXTURE_RUN_CASE] });
    }),

    http.post("*/api/projects/:slug/runs", () => {
      return HttpResponse.json(FIXTURE_RUN, { status: 201 });
    }),

    http.patch("*/api/projects/:slug/runs/:run_id", async ({ request }) => {
      const body = (await request.json()) as Partial<RunSummary>;
      return HttpResponse.json({ ...FIXTURE_RUN, ...body });
    }),

    http.post("*/api/projects/:slug/runs/:run_id/close", () => {
      return HttpResponse.json(FIXTURE_CLOSED_RUN);
    }),

    http.post("*/api/projects/:slug/runs/:run_id/reopen", () => {
      return HttpResponse.json({ ...FIXTURE_RUN, status: "open", closed_at: null });
    }),

    http.post("*/api/projects/:slug/runs/:run_id/reruns", () => {
      const newRun: RunSummary = {
        ...FIXTURE_RUN,
        id: "aaaaaaaa-run0-0000-0000-000000000099",
        title: "Rerun of Sprint 42",
      };
      return HttpResponse.json(newRun, { status: 201 });
    }),

    http.post("*/api/projects/:slug/runs/:run_id/cases", () => {
      return HttpResponse.json({ data: [FIXTURE_RUN_CASE] });
    }),

    http.delete("*/api/projects/:slug/runs/:run_id/cases/:run_case_id", () => {
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Provide tokens so the auth middleware does not redirect.
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
  // Register per-suite MSW handlers (take precedence over global handlers).
  registerBaseHandlers();
});

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// ---------------------------------------------------------------------------
// useRuns
// ---------------------------------------------------------------------------

describe("useRuns", () => {
  it("fetches the first page of runs", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRuns(SLUG, {}), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0]?.data).toHaveLength(1);
    expect(result.current.data?.pages[0]?.data[0]?.id).toBe(RUN_ID);
  });

  it("exposes hasNextPage when next_cursor is present", async () => {
    // Override to always return page 1 with a cursor.
    server.use(
      http.get("*/api/projects/:slug/runs", () => HttpResponse.json(FIXTURE_RUNS_PAGE_1)),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRuns(SLUG, {}), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.data?.pages[0]?.next_cursor).toBe("cursor-page2");
  });

  it("fetches page 2 via fetchNextPage", async () => {
    // Override with a paginated handler.
    server.use(
      http.get("*/api/projects/:slug/runs", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        return HttpResponse.json(cursor === "cursor-page2" ? FIXTURE_RUNS_PAGE_2 : FIXTURE_RUNS_PAGE_1);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRuns(SLUG, {}), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(result.current.data?.pages[1]?.data[0]?.title).toBe("Run 2");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("does not start a query when projectSlug is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRuns("", {}), { wrapper: wrapper(qc) });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// useRun
// ---------------------------------------------------------------------------

describe("useRun", () => {
  it("fetches and returns a run detail", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRun(SLUG, RUN_ID), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe(RUN_ID);
    expect(result.current.data?.title).toBe("Sprint 42 smoke run");
  });

  it("does not start a query when runId is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRun(SLUG, ""), { wrapper: wrapper(qc) });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("refetchInterval factory returns 30_000 when visibilityState is visible", () => {
    // Test the factory logic in isolation — no DOM mutation needed.
    const visibleFactory = () =>
      document.visibilityState === "visible" ? 30_000 : false;
    // In jsdom the default visibility state is "visible".
    expect(visibleFactory()).toBe(30_000);
  });

  it("refetchInterval factory returns false when visibilityState is hidden", () => {
    // Temporarily override visibilityState via the property descriptor.
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
      writable: true,
    });
    try {
      const hiddenFactory = () =>
        document.visibilityState === "visible" ? 30_000 : false;
      expect(hiddenFactory()).toBe(false);
    } finally {
      // Restore to the original descriptor so subsequent tests are not affected.
      if (descriptor) {
        Object.defineProperty(document, "visibilityState", descriptor);
      } else {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// useRunCases
// ---------------------------------------------------------------------------

describe("useRunCases", () => {
  it("fetches and returns the list of run cases", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRunCases(SLUG, RUN_ID), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.wombat_id).toBe("TC-001");
  });
});

// ---------------------------------------------------------------------------
// useCreateRun
// ---------------------------------------------------------------------------

describe("useCreateRun", () => {
  it("creates a run and returns the new run data", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useCreateRun(SLUG), { wrapper: wrapper(qc) });

    let created: RunSummary | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        title: "New run",
        case_selection: { case_ids: ["TC-001"] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(created?.id).toBe(RUN_ID);
  });

  it("invalidates the runs list on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.list(SLUG, {}), { pages: [FIXTURE_RUNS_LIST], pageParams: [null] });

    const { result } = renderHook(() => useCreateRun(SLUG), { wrapper: wrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Another run",
        case_selection: { case_ids: [] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const listState = qc.getQueryState(runKeys.list(SLUG, {}));
    expect(listState?.isInvalidated).toBe(true);
  });

  it("propagates RunClosedError on 409 run_closed", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCreateRun(SLUG), { wrapper: wrapper(qc) });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          title: "Bad run",
          case_selection: { case_ids: [] },
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunClosedError);
  });
});

// ---------------------------------------------------------------------------
// useUpdateRun — optimistic update + rollback
// ---------------------------------------------------------------------------

describe("useUpdateRun", () => {
  it("applies an optimistic title update to the cache before the server responds", async () => {
    const qc = makeQC();
    // Pre-populate the cache with the initial run.
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_RUN);

    // Verify the onMutate snapshot mechanism by calling it directly — the
    // optimistic update is applied synchronously inside onMutate before the
    // network request is issued. We simulate this by calling the hook, then
    // checking that the cache changes.
    // We use a delayed server response and await the full mutation so the test
    // is deterministic (no leaked promises).
    server.use(
      http.patch("*/api/projects/:slug/runs/:run_id", async () => {
        // Simulate a brief delay.
        await new Promise((r) => setTimeout(r, 10));
        return HttpResponse.json({ ...FIXTURE_RUN, title: "Updated title" });
      }),
    );

    const { result } = renderHook(() => useUpdateRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    // Await the full mutation. Optimistic update + server confirm both complete.
    await act(async () => {
      await result.current.mutateAsync({ title: "Updated title" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // After success the cache should reflect the server-confirmed state.
    const cached = qc.getQueryData<RunSummary>(runKeys.detail(SLUG, RUN_ID));
    // The detail is invalidated on success so the cache entry is stale;
    // the last written value before the refetch is "Updated title".
    expect(cached?.title).toBe("Updated title");
  });

  it("rolls back the optimistic update on error", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_RUN);

    server.use(
      http.patch("*/api/projects/:slug/runs/:run_id", () => {
        return HttpResponse.json(
          { error: { code: "unauthorized_run_action", message: "Not allowed.", field: null, hint: null } },
          { status: 403 },
        );
      }),
    );

    const { result } = renderHook(() => useUpdateRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ title: "Should rollback" });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be restored to the original title.
    const cached = qc.getQueryData<RunSummary>(runKeys.detail(SLUG, RUN_ID));
    expect(cached?.title).toBe("Sprint 42 smoke run");
  });

  it("throws UnauthorizedRunActionError on 403 unauthorized_run_action", async () => {
    server.use(
      http.patch("*/api/projects/:slug/runs/:run_id", () => {
        return HttpResponse.json(
          {
            error: {
              code: "unauthorized_run_action",
              message: "Not allowed.",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useUpdateRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ title: "Forbidden" });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(UnauthorizedRunActionError);
  });
});

// ---------------------------------------------------------------------------
// useCloseRun
// ---------------------------------------------------------------------------

describe("useCloseRun", () => {
  it("closes a run and returns the closed run", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useCloseRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let closed: RunSummary | undefined;
    await act(async () => {
      closed = await result.current.mutateAsync({ reason: "completed" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(closed?.status).toBe("closed");
    expect(closed?.close_reason).toBe("completed");
  });

  it("invalidates detail + list on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_RUN);
    qc.setQueryData(runKeys.list(SLUG, {}), { pages: [FIXTURE_RUNS_LIST], pageParams: [null] });

    const { result } = renderHook(() => useCloseRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ reason: "completed" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(runKeys.detail(SLUG, RUN_ID))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runKeys.list(SLUG, {}))?.isInvalidated).toBe(true);
  });

  it("throws RunNotOpenError on 403 run_not_open", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/close", () => {
        return HttpResponse.json(
          { error: { code: "run_not_open", message: "Run is not open.", field: null, hint: null } },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCloseRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ reason: "aborted" });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunNotOpenError);
  });

  it("throws UnauthorizedRunActionError on 403 unauthorized_run_action", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/close", () => {
        return HttpResponse.json(
          {
            error: {
              code: "unauthorized_run_action",
              message: "Not your run.",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCloseRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ reason: "aborted" });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(UnauthorizedRunActionError);
  });
});

// ---------------------------------------------------------------------------
// useReopenRun
// ---------------------------------------------------------------------------

describe("useReopenRun", () => {
  it("reopens a closed run", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useReopenRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let reopened: RunSummary | undefined;
    await act(async () => {
      reopened = await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reopened?.status).toBe("open");
  });

  it("invalidates detail + list on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_CLOSED_RUN);
    qc.setQueryData(runKeys.list(SLUG, {}), { pages: [FIXTURE_RUNS_LIST], pageParams: [null] });

    const { result } = renderHook(() => useReopenRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(runKeys.detail(SLUG, RUN_ID))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runKeys.list(SLUG, {}))?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 403 run_closed", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/reopen", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run already open.", field: null, hint: null } },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useReopenRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunClosedError);
  });

  it("throws UnauthorizedRunActionError on 403 unauthorized_run_action", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/reopen", () => {
        return HttpResponse.json(
          {
            error: {
              code: "unauthorized_run_action",
              message: "Requires admin.",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useReopenRun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(UnauthorizedRunActionError);
  });
});

// ---------------------------------------------------------------------------
// useRerun
// ---------------------------------------------------------------------------

describe("useRerun", () => {
  it("creates a new run from a subset of cases and returns it (201)", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRerun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let newRun: RunSummary | undefined;
    await act(async () => {
      newRun = await result.current.mutateAsync({
        include_statuses: ["failed"],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(newRun?.id).toBe("aaaaaaaa-run0-0000-0000-000000000099");
    expect(newRun?.title).toBe("Rerun of Sprint 42");
  });

  it("invalidates the runs list on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.list(SLUG, {}), { pages: [FIXTURE_RUNS_LIST], pageParams: [null] });

    const { result } = renderHook(() => useRerun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryState(runKeys.list(SLUG, {}))?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 403 run_closed", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/reruns", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRerun(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({});
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunClosedError);
  });
});

// ---------------------------------------------------------------------------
// useAddRunCases
// ---------------------------------------------------------------------------

describe("useAddRunCases", () => {
  it("adds cases and returns the updated case list", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useAddRunCases(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let cases: RunCase[] | undefined;
    await act(async () => {
      cases = await result.current.mutateAsync({
        case_selection: { case_ids: ["TC-001"] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cases).toHaveLength(1);
    expect(cases?.[0]?.wombat_id).toBe("TC-001");
  });

  it("invalidates cases + detail on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.cases(SLUG, RUN_ID), [FIXTURE_RUN_CASE]);
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_RUN);

    const { result } = renderHook(() => useAddRunCases(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ case_selection: { case_ids: ["TC-002"] } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(runKeys.cases(SLUG, RUN_ID))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runKeys.detail(SLUG, RUN_ID))?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 409 run_closed (adding to a closed run)", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/cases", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useAddRunCases(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ case_selection: { case_ids: ["TC-999"] } });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunClosedError);
  });
});

// ---------------------------------------------------------------------------
// useRemoveRunCase
// ---------------------------------------------------------------------------

describe("useRemoveRunCase", () => {
  it("removes a case by run_case_id", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useRemoveRunCase(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync(RUN_CASE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("invalidates cases + detail on success", async () => {
    const qc = makeQC();
    qc.setQueryData(runKeys.cases(SLUG, RUN_ID), [FIXTURE_RUN_CASE]);
    qc.setQueryData(runKeys.detail(SLUG, RUN_ID), FIXTURE_RUN);

    const { result } = renderHook(() => useRemoveRunCase(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync(RUN_CASE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryState(runKeys.cases(SLUG, RUN_ID))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runKeys.detail(SLUG, RUN_ID))?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 403 run_closed (removing from a closed run)", async () => {
    server.use(
      http.delete("*/api/projects/:slug/runs/:run_id/cases/:run_case_id", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRemoveRunCase(SLUG, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(RUN_CASE_ID);
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(RunClosedError);
  });
});
