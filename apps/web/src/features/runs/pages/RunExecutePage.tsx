/**
 * RunExecutePage — full-screen runner entry point.
 *
 * Route: /p/:projectSlug/runs/:id/execute
 * Rendered OUTSIDE AppShell (no sidebar, no header).
 * Loaded via React.lazy to keep the runner bundle separate.
 *
 * Reads:
 *   - :projectSlug, :id from URL path
 *   - ?view=focus|grid  (default: focus)
 *   - ?case=<wombat_id> (jump to specific case)
 *
 * Assembles CaseSnapshot data from:
 *   - useRunCases  → base RunCase objects
 *   - useResults   → existing result rows
 * Then delegates to FocusMode or GridMode based on ?view.
 *
 * IMPORTANT: This file MUST use a default export. React.lazy only works
 * with default exports.
 */

import { useParams, useSearchParams } from "react-router-dom";
import { useRun, useRunCases } from "../hooks/runs";
import { useResults } from "../hooks/results";
import { useRecordWithConflictHandling } from "../lib/record";
import { useActiveProject } from "@/features/projects/useActiveProject";
import { ErrorState } from "@/components/shared/ErrorState";
import { FocusMode, type RunCaseWithSnapshot } from "../runner/FocusMode";
import type { ResultStatus } from "../hooks/results";
import type { CaseSnapshot } from "../runner/CaseRenderer";
import type { Step } from "@/components/shared/StepTable";

// ---------------------------------------------------------------------------
// Loading skeleton — no app chrome
// ---------------------------------------------------------------------------

function RunnerLoadingSkeleton() {
  return (
    <div
      className="flex h-screen w-screen flex-col"
      aria-busy="true"
      aria-label="Loading runner"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Top strip skeleton */}
      <div
        className="h-[72px] border-b px-4 flex items-center gap-3"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        <div
          className="h-5 w-5 rounded animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
        <div
          className="h-4 w-32 rounded animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
        <div className="ml-auto flex gap-2">
          <div
            className="h-7 w-7 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
          <div
            className="h-7 w-7 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
        </div>
      </div>

      {/* Body skeleton */}
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-4">
          {[60, 90, 75, 85, 50].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded animate-pulse"
              style={{
                width: `${w}%`,
                background: "var(--bg-surface-2)",
              }}
            />
          ))}
          <div
            className="mt-4 h-48 rounded-lg animate-pulse"
            style={{
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-default)",
            }}
          />
        </div>
      </div>

      {/* Action bar skeleton */}
      <div
        className="h-[72px] border-t px-4 flex items-center gap-3"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        {[80, 80, 80, 80].map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-xl animate-pulse"
            style={{
              width: `${80}px`,
              background: "var(--bg-surface-3)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunExecutePage
// ---------------------------------------------------------------------------

export default function RunExecutePage() {
  const { projectSlug, id } = useParams<{ projectSlug: string; id: string }>();
  const [searchParams] = useSearchParams();
  const view = (searchParams.get("view") as "focus" | "grid") ?? "focus";

  // projectSlug comes from the URL; useActiveProject is only needed for the
  // sidebar context — here we use the URL slug directly.
  const slug = projectSlug ?? "";
  const runId = id ?? "";

  const runQuery = useRun(slug, runId);
  const casesQuery = useRunCases(slug, runId);
  const resultsQuery = useResults(slug, runId);

  const { record, reconcile, clearReconcile, mutation } =
    useRecordWithConflictHandling(slug, runId);

  // Loading state
  const isLoading =
    runQuery.isLoading || casesQuery.isLoading || resultsQuery.isLoading;

  if (isLoading) {
    return <RunnerLoadingSkeleton />;
  }

  // Error state
  const error = runQuery.error ?? casesQuery.error ?? resultsQuery.error;
  if (error) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center p-8"
        style={{ background: "var(--bg-app)" }}
      >
        <ErrorState
          error={error}
          onRetry={() => {
            void runQuery.refetch();
            void casesQuery.refetch();
            void resultsQuery.refetch();
          }}
        />
      </div>
    );
  }

  const run = runQuery.data;
  const rawCases = casesQuery.data ?? [];
  const resultRows = resultsQuery.data?.data ?? [];

  if (!run) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: "var(--bg-app)", color: "var(--fg-disabled)" }}
      >
        <p className="text-sm">Run not found</p>
      </div>
    );
  }

  // Build results map keyed by case wombat_id
  const resultsMap = new Map(resultRows.map((r) => [r.case_id, r]));

  // Build RunCaseWithSnapshot objects.
  // The RunCase type from the API doesn't carry snapshot fields (those are
  // embedded in the actual test content). Until the schema exposes them, we
  // cast and extract what's available. The snapshot_body / steps are served
  // as part of the run_case detail endpoint in the full API; for now we build
  // a minimal snapshot from the RunCase fields.
  const casesWithSnapshot: RunCaseWithSnapshot[] = rawCases.map((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extended = c as any;
    const snapshot: CaseSnapshot = {
      wombat_id: c.wombat_id,
      title: c.title,
      priority: extended.priority ?? null,
      preconditions: extended.snapshot_preconditions ?? extended.preconditions ?? null,
      steps: (extended.snapshot_steps ?? extended.steps ?? []) as Step[],
      snapshot_content_hash: extended.snapshot_content_hash ?? null,
      current_content_hash: extended.current_content_hash ?? null,
    };
    return {
      ...c,
      snapshot,
    };
  });

  // ---------------------------------------------------------------------------
  // Record handler — wires into useRecordWithConflictHandling
  // ---------------------------------------------------------------------------

  function handleRecord(status: ResultStatus, failedAtStep?: number) {
    const currentCaseParam = searchParams.get("case");
    const currentCase = currentCaseParam
      ? casesWithSnapshot.find((c) => c.wombat_id === currentCaseParam)
      : casesWithSnapshot[0];

    if (!currentCase) return;

    void record({
      case_id: currentCase.wombat_id,
      status,
      notes: null,
      failed_at_step: failedAtStep ?? null,
      bug_links: [],
      duration_ms: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Route to view
  // ---------------------------------------------------------------------------

  if (view === "grid") {
    // GridMode is implemented in Task 51. For now, fall through to FocusMode
    // with a notice. The actual GridMode import is in RunExecutePage after Task 51.
    // We use a dynamic check to avoid importing GridMode (code-split invariant).
    return (
      <FocusMode
        projectSlug={slug}
        run={run}
        cases={casesWithSnapshot}
        results={resultsMap}
        isPending={mutation.isPending}
        reconcile={reconcile}
        onRecord={handleRecord}
        onClearReconcile={clearReconcile}
      />
    );
  }

  return (
    <FocusMode
      projectSlug={slug}
      run={run}
      cases={casesWithSnapshot}
      results={resultsMap}
      isPending={mutation.isPending}
      reconcile={reconcile}
      onRecord={handleRecord}
      onClearReconcile={clearReconcile}
    />
  );
}
