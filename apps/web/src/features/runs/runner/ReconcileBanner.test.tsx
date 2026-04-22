/**
 * Unit tests for ReconcileBanner.
 *
 * Scenarios:
 *  1. Banner renders the other writer's status chip and relative timestamp.
 *  2. "Overwrite with mine" button calls useUpdateResult.mutateAsync with the
 *     correct revision then calls onResolved with the mine status.
 *  3. "Keep theirs" button calls onResolved with the theirs status after a
 *     brief delay.
 *  4. Dismiss button calls onDismiss.
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { ReconcileBanner } from "./ReconcileBanner";
import type { ReconcileState } from "../lib/record";
import type { ResultRow, ResultStatus } from "../hooks/results";

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

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const PROJECT = "alpha-project";
const RUN_ID = "run-abc-123";
const CASE_ID = "case-xyz-001";

const NOW_ISO = new Date(Date.now() - 30_000).toISOString(); // 30 s ago

const THEIRS_ROW: ResultRow = {
  id: "res-001",
  run_id: RUN_ID,
  case_id: CASE_ID,
  status: "fail",
  notes: "flaky network",
  failed_at_step: 2,
  bug_links: [],
  duration_ms: 800,
  revision: 2,
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
};

const MINE_PAYLOAD = {
  case_id: CASE_ID,
  status: "pass" as ResultStatus,
  notes: null,
  failed_at_step: null as number | null,
  bug_links: [] as Array<{ url: string; title?: string | null; note?: string | null }>,
  duration_ms: null as number | null,
};

function buildConflictReconcile(
  overrides: Partial<{
    theirs: ResultRow;
    currentRevision: number;
  }> = {},
): ReconcileState & { kind: "conflict" } {
  return {
    kind: "conflict",
    theirs: overrides.theirs ?? THEIRS_ROW,
    mine: MINE_PAYLOAD,
    currentRevision: overrides.currentRevision ?? 2,
  };
}

const OVERWRITTEN_ROW: ResultRow = {
  ...THEIRS_ROW,
  status: "pass",
  revision: 3,
  updated_at: new Date().toISOString(),
};

interface RenderBannerOptions {
  reconcile?: ReturnType<typeof buildConflictReconcile>;
  onResolved?: (status: ResultStatus | null) => void;
  onDismiss?: () => void;
  qc?: QueryClient;
}

function renderBanner({
  reconcile = buildConflictReconcile(),
  onResolved = vi.fn(),
  onDismiss = vi.fn(),
  qc = makeQC(),
}: RenderBannerOptions = {}) {
  // Plain setup — no fake-timer wiring; tests that need fake timers call
  // vi.useFakeTimers() themselves before renderBanner.
  const user = userEvent.setup();
  render(
    <Wrapper qc={qc}>
      <ReconcileBanner
        reconcile={reconcile}
        projectSlug={PROJECT}
        runId={RUN_ID}
        onResolved={onResolved}
        onDismiss={onDismiss}
      />
    </Wrapper>,
  );
  return { user, onResolved, onDismiss };
}

// ---------------------------------------------------------------------------
// Tests — rendering
// ---------------------------------------------------------------------------

describe("ReconcileBanner — rendering", () => {
  it("renders the conflict alert with the other writer's status chip", () => {
    renderBanner();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/fail/i)).toBeInTheDocument();
  });

  it("renders the overwrite button", () => {
    renderBanner();
    expect(
      screen.getByRole("button", { name: /overwrite/i }),
    ).toBeInTheDocument();
  });

  it("renders the keep theirs button", () => {
    renderBanner();
    expect(
      screen.getByRole("button", { name: /keep theirs/i }),
    ).toBeInTheDocument();
  });

  it("renders the dismiss button", () => {
    renderBanner();
    expect(
      screen.getByRole("button", { name: /dismiss/i }),
    ).toBeInTheDocument();
  });

  it("renders the current revision number", () => {
    renderBanner({ reconcile: buildConflictReconcile({ currentRevision: 7 }) });
    expect(screen.getByText(/rev 7/i)).toBeInTheDocument();
  });

  it("renders the relative timestamp for the other writer's result", () => {
    renderBanner();
    // relativeTime shows "30s ago" for our 30-second-old fixture
    expect(screen.getByText(/s ago/)).toBeInTheDocument();
  });

  it("renders a 'pass' status chip when theirs.status is pass", () => {
    const passTheirs: ResultRow = { ...THEIRS_ROW, status: "pass" };
    renderBanner({ reconcile: buildConflictReconcile({ theirs: passTheirs }) });
    expect(screen.getByText(/pass/i)).toBeInTheDocument();
  });

  it("renders a 'blocked' status chip when theirs.status is blocked", () => {
    const blockedTheirs: ResultRow = { ...THEIRS_ROW, status: "blocked" };
    renderBanner({
      reconcile: buildConflictReconcile({ theirs: blockedTheirs }),
    });
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it("renders a 'skipped' status chip when theirs.status is skipped", () => {
    const skippedTheirs: ResultRow = { ...THEIRS_ROW, status: "skipped" };
    renderBanner({
      reconcile: buildConflictReconcile({ theirs: skippedTheirs }),
    });
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — dismiss
// ---------------------------------------------------------------------------

describe("ReconcileBanner — dismiss", () => {
  it("clicking dismiss calls onDismiss", async () => {
    const { user, onDismiss } = renderBanner();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — overwrite
// ---------------------------------------------------------------------------

describe("ReconcileBanner — overwrite", () => {
  it("calls onResolved with mine.status after successful PUT", async () => {
    server.use(
      http.put(
        "*/api/projects/:slug/runs/:run_id/results/:case_id",
        () => HttpResponse.json({ data: OVERWRITTEN_ROW }),
      ),
    );

    const onResolved = vi.fn();
    const { user } = renderBanner({ onResolved });

    await user.click(screen.getByRole("button", { name: /overwrite/i }));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledOnce();
    });
    expect(onResolved).toHaveBeenCalledWith("pass"); // mine.status
  });

  it("sends the correct currentRevision in the PUT If-Match header", async () => {
    let capturedIfMatch: string | null = null;
    server.use(
      http.put(
        "*/api/projects/:slug/runs/:run_id/results/:case_id",
        ({ request }) => {
          capturedIfMatch = request.headers.get("if-match");
          return HttpResponse.json({ data: OVERWRITTEN_ROW });
        },
      ),
    );

    const { user } = renderBanner({
      reconcile: buildConflictReconcile({ currentRevision: 5 }),
    });

    await user.click(screen.getByRole("button", { name: /overwrite/i }));

    await waitFor(() => {
      expect(capturedIfMatch).toBe("5");
    });
  });

  it("shows 'Overwriting…' spinner label while the mutation is in flight", async () => {
    // Hold the PUT open so we can inspect the in-flight state
    let resolveReq!: () => void;
    server.use(
      http.put(
        "*/api/projects/:slug/runs/:run_id/results/:case_id",
        () =>
          new Promise<Response>((res) => {
            resolveReq = () => res(HttpResponse.json({ data: OVERWRITTEN_ROW }) as unknown as Response);
          }),
      ),
    );

    const { user } = renderBanner();
    const overwriteBtn = screen.getByRole("button", { name: /overwrite/i });

    // Start the click without awaiting the full roundtrip
    const clickPromise = user.click(overwriteBtn);

    // Wait until the spinner text appears (mutation in-flight)
    await waitFor(() => {
      expect(screen.getByText(/overwriting…/i)).toBeInTheDocument();
    });

    // The button should be disabled while in-flight
    expect(overwriteBtn).toBeDisabled();

    // Resolve the request so the test doesn't leak
    resolveReq();
    await clickPromise;
  });

  it("resets to idle phase when PUT returns a server error", async () => {
    server.use(
      http.put(
        "*/api/projects/:slug/runs/:run_id/results/:case_id",
        () =>
          HttpResponse.json(
            { error: { code: "server_error", message: "Unexpected error." } },
            { status: 500 },
          ),
      ),
    );

    const { user } = renderBanner();

    await user.click(screen.getByRole("button", { name: /overwrite/i }));

    // After failure the overwrite button should revert to idle label and be enabled.
    // The accessible name comes from aria-label "Overwrite: record your intended result…"
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /overwrite:/i });
      expect(btn).not.toBeDisabled();
      // Text content should be back to the idle label (not "Overwriting…")
      expect(btn.textContent).toMatch(/overwrite with mine/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — keep theirs
// ---------------------------------------------------------------------------

describe("ReconcileBanner — keep theirs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onResolved with theirs.status after clicking 'Keep theirs'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const onResolved = vi.fn();
    const qc = makeQC();

    render(
      <Wrapper qc={qc}>
        <ReconcileBanner
          reconcile={buildConflictReconcile()}
          projectSlug={PROJECT}
          runId={RUN_ID}
          onResolved={onResolved}
          onDismiss={vi.fn()}
        />
      </Wrapper>,
    );

    await user.click(screen.getByRole("button", { name: /keep theirs/i }));

    // Advance past the 200 ms delay in handleKeepTheirs
    act(() => vi.advanceTimersByTime(250));

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith("fail"); // theirs.status
    });
  });

  it("shows 'Applying…' spinner text immediately after click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const qc = makeQC();

    render(
      <Wrapper qc={qc}>
        <ReconcileBanner
          reconcile={buildConflictReconcile()}
          projectSlug={PROJECT}
          runId={RUN_ID}
          onResolved={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>,
    );

    await user.click(screen.getByRole("button", { name: /keep theirs/i }));

    // Before the 200 ms delay resolves
    expect(screen.getByText(/applying…/i)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(250));
  });

  it("keep-theirs button is disabled during the applying phase", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const qc = makeQC();

    render(
      <Wrapper qc={qc}>
        <ReconcileBanner
          reconcile={buildConflictReconcile()}
          projectSlug={PROJECT}
          runId={RUN_ID}
          onResolved={vi.fn()}
          onDismiss={vi.fn()}
        />
      </Wrapper>,
    );

    const keepBtn = screen.getByRole("button", { name: /keep theirs/i });
    await user.click(keepBtn);

    expect(keepBtn).toBeDisabled();

    act(() => vi.advanceTimersByTime(250));
  });
});
