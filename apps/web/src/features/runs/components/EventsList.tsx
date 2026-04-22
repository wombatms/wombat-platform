/**
 * EventsList — reverse-chronological audit log for a run.
 *
 * Design direction:
 *   Dense monospaced-timestamp gutters, thin horizontal rules, event-type
 *   icons pulled from lucide-react, actor label in a muted pill. The
 *   timeline column on the left is a discrete rail — thin vertical line
 *   connecting icon dots — giving the list a git-log / terminal aesthetic
 *   that is readable at a glance without color-coding every row.
 *
 * States:
 *   Loading  — skeleton rows (3 pulses)
 *   Empty    — EmptyState with Clock icon
 *   Error    — ErrorState with Retry
 *   Success  — list + "Load more" button when hasNextPage
 *
 * Pagination: useRunEvents infinite query (cursor-based, 50 per page).
 * IntersectionObserver auto-fetches next page when the sentinel enters view.
 *
 * SP3.3 Task 48.
 */

import { useEffect, useRef } from "react";
import {
  Plus,
  Minus,
  CheckSquare,
  RefreshCw,
  Paperclip,
  Trash2,
  XCircle,
  RotateCcw,
  UserPlus,
  UserMinus,
  Play,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRunEvents, type RunEvent } from "../hooks/events";

// ---------------------------------------------------------------------------
// Event-type label map
// ---------------------------------------------------------------------------

/**
 * Formats a human-readable summary for a run event.
 * The `detail` payload is used for per-event interpolation.
 */
export function eventTypeToLabel(
  action: string,
  detail: Record<string, unknown> | null,
): string {
  const d = detail ?? {};

  const caseId =
    typeof d.case_id === "string" ? d.case_id : String(d.case_id ?? "");
  const status =
    typeof d.status === "string" ? d.status : String(d.status ?? "");
  const filename =
    typeof d.filename === "string" ? d.filename : String(d.filename ?? "");
  const name = typeof d.name === "string" ? d.name : String(d.name ?? "");

  switch (action) {
    case "run_created":
      return "Run created";
    case "case_added":
      return caseId ? `Case added: ${caseId}` : "Case added";
    case "case_removed":
      return caseId ? `Case removed: ${caseId}` : "Case removed";
    case "result_recorded":
      return caseId && status
        ? `Recorded ${status} on ${caseId}`
        : "Result recorded";
    case "result_updated":
      return caseId && status
        ? `Updated result on ${caseId} → ${status}`
        : "Result updated";
    case "evidence_attached":
      return filename ? `Attached ${filename}` : "Evidence attached";
    case "evidence_removed":
      return "Removed evidence";
    case "run_closed":
      return "Closed as completed";
    case "run_aborted":
      return "Aborted";
    case "run_reopened":
      return "Reopened (admin)";
    case "assignee_added":
      return name ? `Added assignee ${name}` : "Assignee added";
    case "assignee_removed":
      return name ? `Removed assignee ${name}` : "Assignee removed";
    default:
      return action.replace(/_/g, " ");
  }
}

// ---------------------------------------------------------------------------
// Event-type icon map
// ---------------------------------------------------------------------------

function eventTypeIcon(action: string): LucideIcon {
  switch (action) {
    case "run_created":
      return Play;
    case "case_added":
      return Plus;
    case "case_removed":
      return Minus;
    case "result_recorded":
    case "result_updated":
      return CheckSquare;
    case "evidence_attached":
      return Paperclip;
    case "evidence_removed":
      return Trash2;
    case "run_closed":
      return XCircle;
    case "run_aborted":
      return XCircle;
    case "run_reopened":
      return RotateCcw;
    case "assignee_added":
      return UserPlus;
    case "assignee_removed":
      return UserMinus;
    default:
      return RefreshCw;
  }
}

// ---------------------------------------------------------------------------
// Timestamp formatter
// ---------------------------------------------------------------------------

/**
 * Formats an ISO timestamp as a short absolute string:
 *   Same day → "14:32:07"
 *   Different day → "Apr 19 14:32"
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Full ISO for <time datetime="…">
function isoFull(iso: string): string {
  try {
    return new Date(iso).toISOString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Actor label
// ---------------------------------------------------------------------------

function actorLabel(event: RunEvent): string {
  if (event.user_id) {
    // Display name may be embedded in detail.user_name if the API provides it
    const detail = event.detail ?? {};
    const name = typeof detail.user_name === "string" ? detail.user_name : null;
    return name ?? `user:${event.user_id.slice(0, 8)}`;
  }
  if (event.token_id) {
    const detail = event.detail ?? {};
    const name =
      typeof detail.token_name === "string" ? detail.token_name : null;
    return name ?? `token:${event.token_id.slice(0, 8)}`;
  }
  return "system";
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: RunEvent;
  /** Whether this is the last row (no bottom rail segment) */
  isLast: boolean;
}

function EventRow({ event, isLast }: EventRowProps) {
  const Icon = eventTypeIcon(event.action);
  const summary = eventTypeToLabel(event.action, event.detail);
  const actor = actorLabel(event);
  const ts = formatTimestamp(event.created_at);
  const tsISO = isoFull(event.created_at);

  return (
    <li className="flex items-start gap-0" aria-label={summary}>
      {/* ------------------------------------------------------------------ */}
      {/* Timeline rail */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="flex flex-col items-center shrink-0"
        aria-hidden="true"
        style={{ width: 32 }}
      >
        {/* Icon dot */}
        <span
          className={cn(
            "flex items-center justify-center rounded-full shrink-0",
            "mt-2.5",
          )}
          style={{
            width: 20,
            height: 20,
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
            color: "var(--fg-muted)",
          }}
        >
          <Icon
            className="h-2.5 w-2.5"
            aria-hidden={true}
          />
        </span>

        {/* Vertical connector (hidden on last row) */}
        {!isLast && (
          <span
            className="flex-1 w-px mt-1"
            style={{
              background: "var(--border-subtle)",
              minHeight: 12,
            }}
          />
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row body */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={cn(
          "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
          "py-2 pl-2 pr-4 min-w-0 flex-1",
          !isLast && "border-b",
        )}
        style={{
          borderColor: "var(--border-subtle)",
        }}
      >
        {/* Timestamp — monospaced, muted */}
        <time
          dateTime={tsISO}
          className="shrink-0 font-mono text-[11px] leading-5 tabular-nums"
          style={{ color: "var(--fg-disabled)" }}
        >
          {ts}
        </time>

        {/* Summary — default weight */}
        <span
          className="text-xs leading-5 min-w-0 break-words"
          style={{ color: "var(--fg-default)" }}
        >
          {summary}
        </span>

        {/* Actor pill */}
        <span
          className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium leading-5 shrink-0 whitespace-nowrap"
          style={{
            background: "var(--bg-surface-2)",
            color: "var(--fg-muted)",
            border: "1px solid var(--border-subtle)",
          }}
          title={event.token_id ? "API token" : event.user_id ? "User" : "System"}
        >
          {actor}
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRow({ index }: { index: number }) {
  // Vary widths so the skeleton looks organic rather than uniform
  const summaryWidths = [55, 70, 45, 65, 80];
  const summaryW = summaryWidths[index % summaryWidths.length];

  return (
    <li className="flex items-start gap-0" aria-hidden="true">
      {/* Rail */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 32 }}>
        <span
          className="mt-2.5 rounded-full animate-pulse"
          style={{
            width: 20,
            height: 20,
            background: "var(--bg-surface-3)",
          }}
        />
        {index < 2 && (
          <span
            className="w-px mt-1"
            style={{
              background: "var(--border-subtle)",
              height: 24,
            }}
          />
        )}
      </div>

      {/* Body */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 pl-2 pr-4 flex-1 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span
          className="animate-pulse rounded h-3"
          style={{ background: "var(--bg-surface-3)", width: 52 }}
        />
        <span
          className="animate-pulse rounded h-3"
          style={{ background: "var(--bg-surface-3)", width: `${summaryW}%` }}
        />
        <span
          className="animate-pulse rounded h-3"
          style={{ background: "var(--bg-surface-3)", width: 64 }}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface EventsListProps {
  projectSlug: string;
  runId: string;
}

export function EventsList({ projectSlug, runId }: EventsListProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRunEvents(projectSlug, runId);

  // Sentinel ref for IntersectionObserver auto-load
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: "120px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="px-4 py-3" aria-busy="true" aria-label="Loading events">
        <ul className="list-none m-0 p-0">
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} index={i} />
          ))}
        </ul>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Error state
  // ------------------------------------------------------------------
  if (error) {
    return (
      <div className="px-4 py-3">
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="Failed to load events"
        />
      </div>
    );
  }

  // Flatten pages
  const allEvents = data?.pages.flatMap((p) => p.events) ?? [];

  // ------------------------------------------------------------------
  // Empty state
  // ------------------------------------------------------------------
  if (allEvents.length === 0) {
    return (
      <div className="px-4 py-6">
        <EmptyState
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          title="No events yet"
          description="Events are recorded as the run progresses — starting from when the run was created."
        />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Success
  // ------------------------------------------------------------------
  return (
    <div className="px-4 py-3">
      {/* Column header — subtle mono label row */}
      <div
        className="flex gap-x-2 pl-8 pr-4 pb-1.5 mb-1"
        style={{ borderBottom: "1px solid var(--border-default)" }}
        aria-hidden="true"
      >
        <span
          className="w-[52px] shrink-0 font-mono text-[10px] uppercase tracking-wide"
          style={{ color: "var(--fg-disabled)" }}
        >
          Time
        </span>
        <span
          className="flex-1 font-mono text-[10px] uppercase tracking-wide"
          style={{ color: "var(--fg-disabled)" }}
        >
          Event
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-wide"
          style={{ color: "var(--fg-disabled)" }}
        >
          Actor
        </span>
      </div>

      {/* Event rows */}
      <ul
        className="list-none m-0 p-0"
        role="log"
        aria-label="Run events audit log"
        aria-live="polite"
      >
        {allEvents.map((event, idx) => (
          <EventRow
            key={event.id}
            event={event}
            isLast={idx === allEvents.length - 1 && !hasNextPage}
          />
        ))}
      </ul>

      {/* Load more — IntersectionObserver sentinel + fallback button */}
      {hasNextPage && (
        <div ref={sentinelRef} className="pt-3 pb-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full text-xs gap-1.5"
            style={{ color: "var(--fg-muted)" }}
          >
            {isFetchingNextPage ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                Loading more…
              </>
            ) : (
              "Load more events"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
