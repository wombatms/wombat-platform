import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import {
  useResults,
  useRecordResult,
  useRecordResultBatch,
  useUpdateResult,
  useClearResult,
  type ResultRow,
  type ResultListResponse,
} from "./results";
import { runKeys } from "../queryKeys";
import { ResultConflictError, RunClosedError } from "@/lib/api/errors";

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
const CASE_ID = "case-xyz-001";

const FIXTURE_RESULT: ResultRow = {
  id: "res-001",
  run_id: RUN_ID,
  case_id: CASE_ID,
  status: "pass",
  notes: null,
  failed_at_step: null,
  bug_links: [],
  duration_ms: 1234,
  revision: 1,
  created_at: "2026-04-22T10:00:00Z",
  updated_at: "2026-04-22T10:00:00Z",
};

const FIXTURE_RESULT_LIST: ResultListResponse = {
  data: [FIXTURE_RESULT],
  pagination: { next_cursor: null },
};

// ---------------------------------------------------------------------------
// useResults
// ---------------------------------------------------------------------------

describe("useResults", () => {
  it("fetches results for a run", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(FIXTURE_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useResults(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]?.case_id).toBe(CASE_ID);
  });

  it("passes status filter in query params", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/results", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: [], pagination: { next_cursor: null } });
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useResults(PROJECT, RUN_ID, { status: "fail" }), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBeDefined();
    expect(new URL(capturedUrl!).searchParams.get("status")).toBe("fail");
  });

  it("is disabled when projectSlug or runId is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useResults("", RUN_ID), {
      wrapper: wrapper(qc),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isLoading).toBe(false);
  });

  it("propagates API errors as ApiError", async () => {
    server.use(
      http.get("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          { error: { code: "run_not_open", message: "Run is not open.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useResults(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useRecordResultBatch
// ---------------------------------------------------------------------------

describe("useRecordResultBatch", () => {
  it("posts batch results and invalidates results key", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(FIXTURE_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    qc.setQueryData(runKeys.results(PROJECT, RUN_ID), FIXTURE_RESULT_LIST);

    const { result } = renderHook(() => useRecordResultBatch(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync([
        {
          case_id: CASE_ID,
          status: "pass",
          bug_links: [],
        },
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const queryState = qc.getQueryState(runKeys.results(PROJECT, RUN_ID));
    expect(queryState?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 409 run_closed", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRecordResultBatch(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync([
          { case_id: CASE_ID, status: "pass", bug_links: [] },
        ]);
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(RunClosedError);
  });

  it("throws ResultConflictError with currentRevision on 409 result_conflict", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write detected.",
              field: null,
              current_revision: 7,
            },
          },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRecordResultBatch(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync([
          { case_id: CASE_ID, status: "fail", bug_links: [], if_match_revision: 5 },
        ]);
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(ResultConflictError);
    expect((caughtError as ResultConflictError).currentRevision).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// useRecordResult
// ---------------------------------------------------------------------------

describe("useRecordResult", () => {
  it("records a single result and returns the matching row", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(FIXTURE_RESULT_LIST);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useRecordResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let returnedRow: ResultRow | undefined;
    await act(async () => {
      returnedRow = await result.current.mutateAsync({
        case_id: CASE_ID,
        status: "pass",
        bug_links: [],
      });
    });

    expect(returnedRow?.case_id).toBe(CASE_ID);
    expect(returnedRow?.status).toBe("pass");
  });

  it("re-throws ResultConflictError without invalidating on 409", async () => {
    server.use(
      http.post("*/api/projects/:slug/runs/:run_id/results", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Concurrent write.",
              field: null,
              current_revision: 3,
            },
          },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    // Pre-populate result cache to verify no invalidation
    qc.setQueryData(runKeys.results(PROJECT, RUN_ID), FIXTURE_RESULT_LIST);

    const { result } = renderHook(() => useRecordResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          case_id: CASE_ID,
          status: "fail",
          bug_links: [],
          if_match_revision: 1,
        });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(ResultConflictError);
    // The pre-populated cache entry should not be invalidated
    const queryState = qc.getQueryState(runKeys.results(PROJECT, RUN_ID));
    expect(queryState?.isInvalidated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useUpdateResult
// ---------------------------------------------------------------------------

describe("useUpdateResult", () => {
  it("sends If-Match header and updates the result", async () => {
    let capturedIfMatch: string | null = null;
    server.use(
      http.put("*/api/projects/:slug/runs/:run_id/results/:case_id", ({ request }) => {
        capturedIfMatch = request.headers.get("if-match");
        return HttpResponse.json({ data: { ...FIXTURE_RESULT, status: "fail" } });
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useUpdateResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        caseId: CASE_ID,
        revision: 3,
        body: { status: "fail", bug_links: [] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedIfMatch).toBe("3");
  });

  it("throws ResultConflictError with currentRevision on 409 result_conflict", async () => {
    server.use(
      http.put("*/api/projects/:slug/runs/:run_id/results/:case_id", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "result_conflict",
              message: "Revision mismatch.",
              field: null,
              current_revision: 12,
            },
          },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useUpdateResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          caseId: CASE_ID,
          revision: 5,
          body: { status: "pass", bug_links: [] },
        });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(ResultConflictError);
    expect((caughtError as ResultConflictError).currentRevision).toBe(12);
  });

  it("invalidates results key on success", async () => {
    server.use(
      http.put("*/api/projects/:slug/runs/:run_id/results/:case_id", () => {
        return HttpResponse.json({ data: FIXTURE_RESULT });
      }),
    );

    const qc = makeQC();
    qc.setQueryData(runKeys.results(PROJECT, RUN_ID), FIXTURE_RESULT_LIST);

    const { result } = renderHook(() => useUpdateResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        caseId: CASE_ID,
        revision: 1,
        body: { status: "pass", bug_links: [] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const queryState = qc.getQueryState(runKeys.results(PROJECT, RUN_ID));
    expect(queryState?.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useClearResult
// ---------------------------------------------------------------------------

describe("useClearResult", () => {
  it("deletes a result row and invalidates results key", async () => {
    let deletedCaseId: string | undefined;
    server.use(
      http.delete("*/api/projects/:slug/runs/:run_id/results/:case_id", ({ params }) => {
        deletedCaseId = params["case_id"] as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const qc = makeQC();
    qc.setQueryData(runKeys.results(PROJECT, RUN_ID), FIXTURE_RESULT_LIST);

    const { result } = renderHook(() => useClearResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync(CASE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedCaseId).toBe(CASE_ID);
    const queryState = qc.getQueryState(runKeys.results(PROJECT, RUN_ID));
    expect(queryState?.isInvalidated).toBe(true);
  });

  it("throws RunClosedError on 409 run_closed", async () => {
    server.use(
      http.delete("*/api/projects/:slug/runs/:run_id/results/:case_id", () => {
        return HttpResponse.json(
          { error: { code: "run_closed", message: "Run is closed.", field: null, hint: null } },
          { status: 409 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useClearResult(PROJECT, RUN_ID), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(CASE_ID);
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(RunClosedError);
  });
});
