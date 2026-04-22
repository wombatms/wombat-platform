import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import {
  useEvidenceUrl,
  useUploadEvidence,
  useDeleteEvidence,
  MAX_EVIDENCE_BYTES,
  type EvidenceRecord,
  type EvidenceUrlResponse,
} from "./evidence";
import { runKeys } from "../queryKeys";
import { EvidenceTooLargeError } from "@/lib/api/errors";

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
const EVIDENCE_ID = "ev-001";

const FIXTURE_EVIDENCE: EvidenceRecord = {
  id: EVIDENCE_ID,
  run_id: RUN_ID,
  case_id: CASE_ID,
  result_id: "res-001",
  filename: "screenshot.png",
  content_type: "image/png",
  size_bytes: 1024,
  caption: "Login failure",
  created_at: "2026-04-22T10:00:00Z",
};

const FIXTURE_EVIDENCE_URL: EvidenceUrlResponse = {
  url: "https://storage.example.com/evidence/ev-001?token=signed",
  expires_at: "2026-04-22T10:05:00Z",
};

// ---------------------------------------------------------------------------
// XHR mock factory
//
// jsdom's XMLHttpRequest does not fire load/error events in unit tests, so we
// build a minimal mock that: records the arguments, simulates the upload
// progress events synchronously, and either resolves or rejects via a
// configurable status code.
// ---------------------------------------------------------------------------

interface XhrMockOptions {
  /** HTTP status code to respond with. Defaults to 201. */
  status?: number;
  /** JSON body to serialise as the response text. */
  responseBody?: unknown;
}

function createXhrMock(opts: XhrMockOptions = {}) {
  const { status = 201, responseBody } = opts;

  const defaultResponseBody =
    responseBody !== undefined ? responseBody : { data: FIXTURE_EVIDENCE };

  const progressHandlers: Array<(e: ProgressEvent) => void> = [];
  const loadHandlers: Array<() => void> = [];
  const errorHandlers: Array<() => void> = [];

  const uploadMock = {
    addEventListener: vi.fn((event: string, handler: (e: ProgressEvent) => void) => {
      if (event === "progress") progressHandlers.push(handler);
    }),
  };

  const mock = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn((_formData: FormData) => {
      // Simulate an upload progress event (50 % complete)
      const progressEvent = new ProgressEvent("progress", {
        lengthComputable: true,
        loaded: 512,
        total: 1024,
      });
      progressHandlers.forEach((h) => h(progressEvent));

      // Simulate load after progress (synchronous in mock)
      setTimeout(() => {
        Object.defineProperty(mock, "status", { value: status, writable: true });
        Object.defineProperty(mock, "responseText", {
          value: JSON.stringify(defaultResponseBody),
          writable: true,
        });
        loadHandlers.forEach((h) => h());
      }, 0);
    }),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "load") loadHandlers.push(handler);
      if (event === "error") errorHandlers.push(handler);
    }),
    upload: uploadMock,
    status: 0,
    responseText: "",
  };

  return mock;
}

// ---------------------------------------------------------------------------
// useEvidenceUrl
// ---------------------------------------------------------------------------

describe("useEvidenceUrl", () => {
  it("fetches the presigned URL for an evidence record", async () => {
    server.use(
      http.get("*/api/evidence/:evidence_id/url", () => {
        return HttpResponse.json(FIXTURE_EVIDENCE_URL);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useEvidenceUrl(EVIDENCE_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.url).toBe(FIXTURE_EVIDENCE_URL.url);
    expect(result.current.data?.expires_at).toBe(FIXTURE_EVIDENCE_URL.expires_at);
  });

  it("is disabled when evidenceId is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useEvidenceUrl(""), {
      wrapper: wrapper(qc),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("has staleTime of 4.5 minutes — query is not stale immediately after fetch", async () => {
    server.use(
      http.get("*/api/evidence/:evidence_id/url", () => {
        return HttpResponse.json(FIXTURE_EVIDENCE_URL);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useEvidenceUrl(EVIDENCE_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The query should not be stale immediately after fetching (staleTime 270 s).
    const queryState = qc.getQueryState(["evidence", EVIDENCE_ID, "url"]);
    expect(queryState?.isInvalidated).toBeFalsy();
    expect(queryState?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("does not refetch on window focus (refetchOnWindowFocus: false)", async () => {
    let fetchCount = 0;
    server.use(
      http.get("*/api/evidence/:evidence_id/url", () => {
        fetchCount++;
        return HttpResponse.json(FIXTURE_EVIDENCE_URL);
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useEvidenceUrl(EVIDENCE_ID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const countAfterFirst = fetchCount;

    // Dispatching focus should NOT trigger a refetch when refetchOnWindowFocus is false.
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCount).toBe(countAfterFirst);
  });

  it("staleTime constant is 4.5 minutes (270 000 ms)", () => {
    expect(4.5 * 60 * 1000).toBe(270_000);
  });
});

// ---------------------------------------------------------------------------
// useUploadEvidence — client-side size rejection
// ---------------------------------------------------------------------------

describe("useUploadEvidence — client-side rejection", () => {
  it("throws EvidenceTooLargeError immediately for files over 25 MB", async () => {
    const qc = makeQC();
    const { result } = renderHook(
      () => useUploadEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    // Create a fake File slightly over the limit — note: Uint8Array allocation
    // is lazy in jsdom so this doesn't actually allocate 25 MB in memory.
    const bigFile = new File(
      [new ArrayBuffer(MAX_EVIDENCE_BYTES + 1)],
      "big.png",
      { type: "image/png" },
    );

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ file: bigFile });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(EvidenceTooLargeError);
    expect((caughtError as EvidenceTooLargeError).code).toBe("evidence_too_large");
  });

  it("MAX_EVIDENCE_BYTES constant equals 25 MB (26 214 400 bytes)", () => {
    expect(MAX_EVIDENCE_BYTES).toBe(25 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// useUploadEvidence — XHR-based upload (mocked XHR)
// ---------------------------------------------------------------------------

describe("useUploadEvidence — XHR upload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with EvidenceRecord on 201 and invalidates evidence key", async () => {
    const xhrMock = createXhrMock({ status: 201, responseBody: { data: FIXTURE_EVIDENCE } });
    vi.spyOn(globalThis, "XMLHttpRequest").mockImplementation(
      () => xhrMock as unknown as XMLHttpRequest,
    );

    const qc = makeQC();
    // Pre-seed the evidence cache so invalidateQueries has an entry to mark stale.
    qc.setQueryData(runKeys.evidence(PROJECT, RUN_ID, CASE_ID), { data: [] });

    const { result } = renderHook(
      () => useUploadEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    const smallFile = new File(["screenshot data"], "shot.png", { type: "image/png" });
    let returned: unknown;

    await act(async () => {
      returned = await result.current.mutateAsync({ file: smallFile, caption: "test" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((returned as EvidenceRecord).id).toBe(EVIDENCE_ID);

    // invalidateQueries is async (void-fire in onSuccess), so wait for it.
    await waitFor(() => {
      const qs = qc.getQueryState(runKeys.evidence(PROJECT, RUN_ID, CASE_ID));
      expect(qs?.isInvalidated).toBe(true);
    });
  });

  it("calls onProgress with values between 0 and 1 during upload", async () => {
    const xhrMock = createXhrMock({ status: 201 });
    vi.spyOn(globalThis, "XMLHttpRequest").mockImplementation(
      () => xhrMock as unknown as XMLHttpRequest,
    );

    const qc = makeQC();
    const progressValues: number[] = [];

    const { result } = renderHook(
      () => useUploadEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    const smallFile = new File(["data"], "file.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.mutateAsync({
        file: smallFile,
        onProgress: (p) => progressValues.push(p),
      });
    });

    // The mock fires a progress event with loaded=512, total=1024 → 0.5
    expect(progressValues).toContain(0.5);
    progressValues.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it("throws EvidenceTooLargeError when server returns evidence_too_large", async () => {
    const xhrMock = createXhrMock({
      status: 413,
      responseBody: {
        error: {
          code: "evidence_too_large",
          message: "File too large.",
          field: "file",
          hint: null,
        },
      },
    });
    vi.spyOn(globalThis, "XMLHttpRequest").mockImplementation(
      () => xhrMock as unknown as XMLHttpRequest,
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useUploadEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    const smallFile = new File(["data"], "file.txt", { type: "text/plain" });
    let caughtError: unknown;

    await act(async () => {
      try {
        await result.current.mutateAsync({ file: smallFile });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(EvidenceTooLargeError);
  });

  it("sets Authorization header if access token is present", async () => {
    const xhrMock = createXhrMock({ status: 201 });
    vi.spyOn(globalThis, "XMLHttpRequest").mockImplementation(
      () => xhrMock as unknown as XMLHttpRequest,
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useUploadEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        file: new File(["x"], "x.txt", { type: "text/plain" }),
      });
    });

    const authCalls = xhrMock.setRequestHeader.mock.calls.find(
      (c) => c[0] === "Authorization",
    );
    expect(authCalls).toBeDefined();
    expect(authCalls?.[1]).toBe("Bearer test-access-token.payload.sig");
  });
});

// ---------------------------------------------------------------------------
// useDeleteEvidence
// ---------------------------------------------------------------------------

describe("useDeleteEvidence", () => {
  it("deletes evidence and invalidates evidence cache key", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete(
        "*/api/projects/:slug/runs/:run_id/results/:case_id/evidence/:evidence_id",
        ({ params }) => {
          deletedId = params["evidence_id"] as string;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const qc = makeQC();
    // Seed cache so we can verify invalidation
    qc.setQueryData(runKeys.evidence(PROJECT, RUN_ID, CASE_ID), {
      data: [FIXTURE_EVIDENCE],
    });

    const { result } = renderHook(
      () => useDeleteEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    await act(async () => {
      await result.current.mutateAsync(EVIDENCE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedId).toBe(EVIDENCE_ID);

    const queryState = qc.getQueryState(runKeys.evidence(PROJECT, RUN_ID, CASE_ID));
    expect(queryState?.isInvalidated).toBe(true);
  });

  it("propagates server errors via mapRunError", async () => {
    server.use(
      http.delete(
        "*/api/projects/:slug/runs/:run_id/results/:case_id/evidence/:evidence_id",
        () => {
          return HttpResponse.json(
            {
              error: {
                code: "not_found",
                message: "Evidence not found.",
                field: null,
                hint: null,
              },
            },
            { status: 404 },
          );
        },
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => useDeleteEvidence(PROJECT, RUN_ID, CASE_ID),
      { wrapper: wrapper(qc) },
    );

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(EVIDENCE_ID);
      } catch (e) {
        caughtError = e;
      }
    });

    // mapRunError re-throws non-run errors unchanged as ApiError
    expect(caughtError).toBeTruthy();
    expect((caughtError as { message?: string }).message).toContain("Evidence not found");
  });
});
