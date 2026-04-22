/**
 * RunDetailPage — full run header + URL-driven tabs.
 *
 * States:
 *   Loading  → skeleton header + tab list
 *   Error    → ErrorState with Retry
 *   Not found → friendly 404 panel
 *   Success  → RunDetailHeader + RunDetailTabs
 *
 * Tab content (Cases / Evidence / Events) is provided as slot props to
 * RunDetailTabs. Each slot is null here until Tasks 46–48 wire them in.
 *
 * SP3.3 Task 45.
 */

import { useParams } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useRun } from "../hooks/runs";
import { RunDetailHeader, RunDetailHeaderSkeleton } from "../components/RunDetailHeader";
import { RunDetailTabs } from "../components/RunDetailTabs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNotFound(error: unknown): boolean {
  if (!error) return false;
  // API client 404 surfaces as { status: 404 } or a message containing "not found"
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 404
  ) {
    return true;
  }
  if (error instanceof Error) {
    return (
      error.message.toLowerCase().includes("not found") ||
      error.message.includes("404")
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RunDetailSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true">
      <RunDetailHeaderSkeleton />

      {/* Tabs skeleton */}
      <div
        className="flex items-end gap-1 px-5 pt-3 pb-0"
        style={{
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-app)",
        }}
      >
        {[60, 72, 56].map((w, i) => (
          <div
            key={i}
            className="h-8 rounded-t animate-pulse"
            style={{
              background: "var(--bg-surface-3)",
              width: `${w}px`,
            }}
          />
        ))}
      </div>

      {/* Body skeleton rows */}
      <div className="p-5 flex flex-col gap-3">
        {[85, 70, 90, 65, 80].map((w, i) => (
          <div
            key={i}
            className="h-8 rounded animate-pulse"
            style={{ background: "var(--bg-surface-2)", width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not-found panel
// ---------------------------------------------------------------------------

function RunNotFound({ id }: { id: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <EmptyState
        icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
        title="Run not found"
        description={`No run with ID "${id}" exists in this project, or you do not have permission to view it.`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function RunDetailPage() {
  const { projectSlug = "", id = "" } = useParams<{
    projectSlug: string;
    id: string;
  }>();

  const { data: run, isLoading, error, refetch } = useRun(projectSlug, id);

  // Loading state
  if (isLoading) {
    return <RunDetailSkeleton />;
  }

  // Error state
  if (error) {
    if (isNotFound(error)) {
      return (
        <div className="flex flex-col h-full">
          <RunNotFound id={id} />
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <div className="p-6">
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            title="Failed to load run"
          />
        </div>
      </div>
    );
  }

  // Not found (query succeeded but returned nothing)
  if (!run) {
    return (
      <div className="flex flex-col h-full">
        <RunNotFound id={id} />
      </div>
    );
  }

  // Success — full layout
  return (
    <div className="flex flex-col h-full min-h-0">
      <RunDetailHeader run={run} />
      <RunDetailTabs
        // Slot props are null until Tasks 46–48 wire in their components.
        casesContent={null}
        evidenceContent={null}
        eventsContent={null}
      />
    </div>
  );
}
