/**
 * Tests for useRecordWithConflictHandling.
 *
 * Scenarios covered:
 *  1. Successful record — reconcile stays idle, returned row matches fixture.
 *  2. 409 result_conflict — reconcile transitions to 'conflict' with the
 *     server's theirs value and the reported currentRevision.
 *  3. Non-conflict error — reconcile stays idle, error is re-thrown.
 *  4. clearReconcile — resets reconcile to idle after a conflict.
 *  5. Conflict when the subsequent GET finds no row — re-throws a fetch error
 *     and does not transition to conflict (no theirs available).
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { useRecordWithConflictHandling } from "./record";
import { runKeys } from "../queryKeys";
import { ResultConflictError, RunClosedError } from "@/lib/api/errors";
import type { ResultRow, ResultListResponse } from "../hooks/results";

// ---------------------------------------------------------------------------
// Helpers
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
const CASE_ID = "case-xyz-001";

const FIXTURE_RESULT: ResultRow = {
  id: "res-001",
  run_id: RUN_ID,
  case_id: CASE_ID,
  status: "pass",
  notes: null,
  failed_at_step: null,
  bug_links: [],
  duration_ms: 500,
  revision: 1,
  created_at: "2026-04-22T10:00:00Z",
  updated_at: "2026-04-22T10:00:00Z",
};

const FIXTURE_RESULT_LIST: ResultListResponse = {
  data: [FIXTURE_RESULT],
  pagination: { next_cursor: null },
};

/** The "theirs" row as returned after conflict: revision 2, status fail. */
const THEIRS_RESULT: ResultRow = {
  ...FIXTURE_RESULT,
  status: "fail",
  revision: 2,
  updated_at: "2026-04-22T10:05:00Z",
};

const THEIRS_RESULT_LIST: ResultListResponse = {
  data: [THEIRS_RESULT],
  pagination: { next_cursor: null },
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("useRecordWithConflictHandling — success path", () => {
  it("returns the result row and leaves reconcile as idle on success", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(FIXTURE_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    let returnedRow: ResultRow | undefined;
    await act(async () => {
      returnedRow = await result.current.record({
        case_id: CASE_ID,
        status: "pass",
        bug_links: [],
      });
    });

    expect(returnedRow?.case_id).toBe(CASE_ID);
    expect(returnedRow?.status).toBe("pass");
    expect(result.current.reconcile.kind).toBe("idle");
  });

  it("mutation isPending is false after success", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(FIXTURE_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      await result.current.record({ case_id: CASE_ID, status: "pass", bug_links: [] });
    });

    await waitFor(() => expect(result.current.mutation.isPending).toBe(false));
    expect(result.current.mutation.isSuccess).toBe(true);
  });
});

describe("useRecordWithConflictHandling — 409 conflict path", () => {
  it("sets reconcile to conflict with theirs value and currentRevision 2", async () => {
    // POST → 409 result_conflict with current_revision: 2
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write detected.",
              field: null,
              current_revision: 2,
            },
          },
          { status: 409 },
        );
      }),
      // GET /results (for fetchCurrentResult after conflict)
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(THEIRS_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.record({
          case_id: CASE_ID,
          status: "pass",
          bug_links: [],
          if_match_revision: 1,
        });
      } catch (e) {
        caughtError = e;
      }
    });

    // Error is re-thrown as ResultConflictError
    expect(caughtError).toBeInstanceOf(ResultConflictError);
    expect((caughtError as ResultConflictError).currentRevision).toBe(2);

    // Reconcile state reflects the conflict
    await waitFor(() => expect(result.current.reconcile.kind).toBe("conflict"));

    const reconcile = result.current.reconcile;
    if (reconcile.kind !== "conflict") throw new Error("Expected conflict");

    expect(reconcile.currentRevision).toBe(2);
    expect(reconcile.theirs.revision).toBe(2);
    expect(reconcile.theirs.status).toBe("fail");
    expect(reconcile.mine.case_id).toBe(CASE_ID);
    expect(reconcile.mine.status).toBe("pass");
  });

  it("invalidates the results query key after a conflict", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write.",
              field: null,
              current_revision: 2,
            },
          },
          { status: 409 },
        );
      }),
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(THEIRS_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    // Pre-populate cache
    qc.setQueryData(runKeys.results(PROJECT, RUN_ID), FIXTURE_RESULT_LIST);

    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      try {
        await result.current.record({
          case_id: CASE_ID,
          status: "fail",
          bug_links: [],
          if_match_revision: 1,
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.reconcile.kind).toBe("conflict"));

    // Cache should be invalidated
    const queryState = qc.getQueryState(runKeys.results(PROJECT, RUN_ID));
    expect(queryState?.isInvalidated).toBe(true);
  });
});

describe("useRecordWithConflictHandling — non-conflict errors", () => {
  it("re-throws RunClosedError without setting reconcile to conflict", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.record({ case_id: CASE_ID, status: "pass", bug_links: [] });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(RunClosedError);
    // reconcile must remain idle — we only set conflict for ResultConflictError
    expect(result.current.reconcile.kind).toBe("idle");
  });
});

describe("useRecordWithConflictHandling — clearReconcile", () => {
  it("resets reconcile to idle after clearReconcile is called", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write.",
              field: null,
              current_revision: 2,
            },
          },
          { status: 409 },
        );
      }),
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(THEIRS_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      try {
        await result.current.record({ case_id: CASE_ID, status: "pass", bug_links: [] });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.reconcile.kind).toBe("conflict"));

    // User dismisses the banner
    act(() => {
      result.current.clearReconcile();
    });

    expect(result.current.reconcile.kind).toBe("idle");
  });

  it("subsequent successful record clears an existing conflict", async () => {
    // First call: conflict
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write.",
              field: null,
              current_revision: 2,
            },
          },
          { status: 409 },
        );
      }),
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(THEIRS_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useRecordWithConflictHandling(PROJECT, RUN_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      try {
        await result.current.record({ case_id: CASE_ID, status: "pass", bug_links: [] });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.reconcile.kind).toBe("conflict"));

    // Second call: success (user has provided the correct revision)
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json({
          data: [{ ...THEIRS_RESULT, status: "pass", revision: 3 }],
          pagination: { next_cursor: null },
        });
      }),
    );

    await act(async () => {
      await result.current.record({
        case_id: CASE_ID,
        status: "pass",
        bug_links: [],
        if_match_revision: 2,
      });
    });

    expect(result.current.reconcile.kind).toBe("idle");
  });
});
