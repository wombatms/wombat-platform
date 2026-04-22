/**
 * RunCasesTable — virtualized, filterable table of cases belonging to a run.
 *
 * Design direction: industrial-utilitarian data table.  Dense information
 * hierarchy with precise typographic rhythm.  Status chips use the established
 * `--result-*` token family; priority chips reuse `ResourceBadge`.  The left
 * accent rule on the selected row and the monospace wombat_id column anchor
 * the industrial aesthetic without gratuitous decoration.
 *
 * Data model:
 *   - `useRunCases`  → ordered RunCase rows (id, wombat_id, title, position, …)
 *   - `useResults`   → ResultRow list keyed by case_id
 *   The two lists are joined in-memory: each RunCase is enriched with its
 *   matching ResultRow (if any) so the table can show status + recorded-by.
 *
 * URL params consumed:
 *   ?tab=cases            (managed by parent RunDetailTabs — not this component)
 *   ?status=pass|fail|blocked|skipped|not_run   (multi-value, comma-separated)
 *
 * Row click → navigate('/p/:slug/runs/:id/execute?case=<wombat_id>')
 *
 * SP3.3 Task 46.
 */

import { useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  Ban,
  SkipForward,
  Circle,
  ListChecks,
  User,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { EntityTable } from "@/components/shared/EntityTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ResourceBadge } from "@/components/shared/ResourceBadge";
import type { ResourcePriority } from "@/components/shared/ResourceBadge";
import { cn } from "@/lib/utils";
import { useRunCases, type RunCase } from "../hooks/runs";
import { useResults, type ResultRow, type ResultStatus } from "../hooks/results";

/**
 * Relative time helper — no external date library dependency.
 * Returns strings like "2 min ago", "3 hr ago", "5 days ago", or a short date.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All five possible case states for display purposes. */
export type CaseDisplayStatus = ResultStatus | "not_run";

/** RunCase enriched with its optional result row. */
export interface CaseRow {
  id: string; // run_case junction id
  wombat_id: string;
  title: string;
  position: number;
  priority: ResourcePriority | null;
  /** Joined from results; null = not yet recorded. */
  result: ResultRow | null;
  /** Derived: ResultStatus or "not_run" */
  display_status: CaseDisplayStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STATUS_VALUES: CaseDisplayStatus[] = [
  "pass",
  "fail",
  "blocked",
  "skipped",
  "not_run",
];

const STATUS_PARAM = "status";

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

interface CaseResultChipProps {
  status: CaseDisplayStatus;
  size?: "sm" | "md";
  className?: string;
}

interface CaseStatusConfig {
  label: string;
  fgVar: string;
  bgVar: string;
  icon: React.ReactNode;
}

function getCaseStatusConfig(status: CaseDisplayStatus): CaseStatusConfig {
  switch (status) {
    case "pass":
      return {
        label: "Pass",
        fgVar: "var(--result-pass-fg)",
        bgVar: "var(--result-pass-bg)",
        icon: (
          <CheckCircle2
            className="h-2.5 w-2.5 shrink-0"
            aria-hidden="true"
            strokeWidth={2.5}
          />
        ),
      };
    case "fail":
      return {
        label: "Fail",
        fgVar: "var(--result-fail-fg)",
        bgVar: "var(--result-fail-bg)",
        icon: (
          <XCircle
            className="h-2.5 w-2.5 shrink-0"
            aria-hidden="true"
            strokeWidth={2.5}
          />
        ),
      };
    case "blocked":
      return {
        label: "Blocked",
        fgVar: "var(--result-blocked-fg)",
        bgVar: "var(--result-blocked-bg)",
        icon: (
          <Ban
            className="h-2.5 w-2.5 shrink-0"
            aria-hidden="true"
            strokeWidth={2.5}
          />
        ),
      };
    case "skipped":
      return {
        label: "Skipped",
        fgVar: "var(--result-skipped-fg)",
        bgVar: "var(--result-skipped-bg)",
        icon: (
          <SkipForward
            className="h-2.5 w-2.5 shrink-0"
            aria-hidden="true"
            strokeWidth={2.5}
          />
        ),
      };
    case "not_run":
    default:
      return {
        label: "Not run",
        fgVar: "var(--result-not_run-fg)",
        bgVar: "var(--result-not_run-bg)",
        icon: (
          <Circle
            className="h-2.5 w-2.5 shrink-0"
            aria-hidden="true"
            strokeWidth={2}
          />
        ),
      };
  }
}

/**
 * CaseResultChip — per-case result status pill using `--result-*` tokens.
 * Non-color cue: icon + shape + color (spec §5 accessibility).
 */
export function CaseResultChip({
  status,
  size = "sm",
  className,
}: CaseResultChipProps) {
  const config = getCaseStatusConfig(status);

  return (
    <span
      role="img"
      aria-label={`Status: ${config.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium shrink-0",
        "uppercase tracking-wide",
        size === "sm"
          ? "h-5 px-2 text-[10px]"
          : "h-6 px-2.5 text-[11px]",
        className,
      )}
      style={{
        color: config.fgVar,
        background: config.bgVar,
      }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status filter bar
// ---------------------------------------------------------------------------

interface StatusFilterBarProps {
  active: CaseDisplayStatus[];
  counts: Record<CaseDisplayStatus, number>;
  onChange: (next: CaseDisplayStatus[]) => void;
}

function StatusFilterBar({ active, counts, onChange }: StatusFilterBarProps) {
  const toggle = (s: CaseDisplayStatus) => {
    if (active.includes(s)) {
      onChange(active.filter((v) => v !== s));
    } else {
      onChange([...active, s]);
    }
  };

  return (
    <div
      role="group"
      aria-label="Filter by result status"
      className="flex flex-wrap items-center gap-1.5 px-4 py-2"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wider mr-1"
        style={{ color: "var(--fg-muted)" }}
      >
        Status
      </span>

      {ALL_STATUS_VALUES.map((s) => {
        const isActive = active.includes(s);
        const count = counts[s];
        const config = getCaseStatusConfig(s);

        return (
          <button
            key={s}
            type="button"
            role="checkbox"
            aria-checked={isActive}
            aria-label={`Filter ${config.label} (${count})`}
            onClick={() => toggle(s)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full h-5 px-2",
              "text-[10px] font-semibold uppercase tracking-wide",
              "transition-[opacity,box-shadow] duration-100 outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              !isActive && "opacity-40 hover:opacity-70",
            )}
            style={{
              color: config.fgVar,
              background: isActive ? config.bgVar : "transparent",
              border: `1px solid ${isActive ? config.fgVar : "transparent"}`,
            }}
          >
            {config.icon}
            {config.label}
            {count > 0 && (
              <span
                className="ml-0.5 tabular-nums"
                style={{ opacity: 0.75 }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}

      {active.length > 0 && (
        <button
          type="button"
          aria-label="Clear status filters"
          onClick={() => onChange([])}
          className={cn(
            "inline-flex items-center gap-1 rounded-full h-5 px-2",
            "text-[10px] font-medium uppercase tracking-wide",
            "transition-opacity duration-100 outline-none",
            "hover:opacity-100 opacity-60",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            color: "var(--fg-muted)",
            border: "1px dashed var(--border-strong)",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(
  onRowClick: (row: CaseRow) => void,
): ColumnDef<CaseRow>[] {
  return [
    {
      id: "wombat_id",
      accessorKey: "wombat_id",
      header: "ID",
      size: 120,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ getValue }) => (
        <span
          className="font-mono text-[11px] tracking-tight truncate"
          style={{ color: "var(--fg-muted)" }}
        >
          {String(getValue())}
        </span>
      ),
    },
    {
      id: "title",
      accessorKey: "title",
      header: "Title",
      // Flexible — takes remaining space
      meta: { className: "min-w-0" },
      cell: ({ row, getValue }) => (
        <button
          type="button"
          aria-label={`Open runner for ${String(getValue())}`}
          onClick={(e) => {
            // Prevent the EntityTable row click from double-firing.
            e.stopPropagation();
            onRowClick(row.original);
          }}
          className={cn(
            "truncate text-left text-sm font-medium w-full",
            "outline-none focus-visible:underline",
            "hover:underline decoration-[color:var(--accent-primary)] underline-offset-2",
          )}
          style={{ color: "var(--fg-default)" }}
        >
          {String(getValue())}
        </button>
      ),
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: "Priority",
      size: 88,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ getValue }) => {
        const priority = getValue() as ResourcePriority | null;
        if (!priority) {
          return (
            <span
              className="text-[11px]"
              style={{ color: "var(--fg-disabled)" }}
            >
              —
            </span>
          );
        }
        return <ResourceBadge variant="priority" value={priority} />;
      },
    },
    {
      id: "display_status",
      accessorKey: "display_status",
      header: "Status",
      size: 104,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ getValue }) => (
        <CaseResultChip status={getValue() as CaseDisplayStatus} />
      ),
    },
    {
      id: "recorded_by",
      header: "Recorded by",
      size: 140,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ row }) => {
        const result = row.original.result;
        if (!result) {
          return (
            <span
              className="text-[11px]"
              style={{ color: "var(--fg-disabled)" }}
            >
              —
            </span>
          );
        }
        // ResultRow does not carry a user display name — show the case_id as
        // actor reference until a richer actor model is wired in.
        return (
          <span
            className="inline-flex items-center gap-1 text-[11px] truncate"
            style={{ color: "var(--fg-muted)" }}
          >
            <User className="h-3 w-3 shrink-0" aria-hidden="true" />
            {result.case_id.slice(0, 8)}
          </span>
        );
      },
    },
    {
      id: "updated",
      header: "Updated",
      size: 112,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ row }) => {
        const result = row.original.result;
        if (!result) {
          return (
            <span
              className="text-[11px]"
              style={{ color: "var(--fg-disabled)" }}
            >
              —
            </span>
          );
        }
        return (
          <time
            dateTime={result.updated_at}
            title={new Date(result.updated_at).toLocaleString()}
            className="text-[11px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {relativeTime(result.updated_at)}
          </time>
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RunCasesTableSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading cases">
      {/* Filter bar skeleton */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        {[48, 52, 60, 56, 72, 64].map((w, i) => (
          <div
            key={i}
            className="h-5 rounded-full animate-pulse"
            style={{ background: "var(--bg-surface-3)", width: `${w}px` }}
          />
        ))}
      </div>

      {/* Header row skeleton */}
      <div
        className="flex items-center gap-0 px-0"
        style={{
          height: 34,
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {[120, undefined, 88, 104, 140, 112].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded animate-pulse mx-3"
            style={{
              background: "var(--bg-surface-3)",
              width: w ? `${w - 24}px` : "120px",
              flexGrow: w === undefined ? 1 : 0,
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Body rows */}
      <div className="flex-1 relative">
        {[90, 75, 85, 60, 80, 70, 88, 65].map((w, i) => (
          <div
            key={i}
            className="flex items-center px-3 gap-3"
            style={{
              height: 36,
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="h-3 rounded animate-pulse shrink-0"
              style={{ background: "var(--bg-surface-3)", width: 88 }}
            />
            <div
              className="h-3 rounded animate-pulse flex-1"
              style={{ background: "var(--bg-surface-2)", maxWidth: `${w}%` }}
            />
            <div
              className="h-4 rounded animate-pulse shrink-0"
              style={{ background: "var(--bg-surface-3)", width: 52 }}
            />
            <div
              className="h-4 rounded-full animate-pulse shrink-0"
              style={{ background: "var(--bg-surface-3)", width: 72 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface RunCasesTableProps {
  projectSlug: string;
  runId: string;
}

/**
 * RunCasesTable — cases tab content for RunDetailPage.
 *
 * Fetches both the ordered case list and the results map, joins them
 * client-side, applies status filter from URL params, and renders via
 * the shared EntityTable (virtualized).
 */
export function RunCasesTable({ projectSlug, runId }: RunCasesTableProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse active status filters from URL
  const rawStatus = searchParams.get(STATUS_PARAM);
  const activeStatuses: CaseDisplayStatus[] = useMemo(() => {
    if (!rawStatus) return [];
    return rawStatus
      .split(",")
      .filter((s): s is CaseDisplayStatus =>
        ALL_STATUS_VALUES.includes(s as CaseDisplayStatus),
      );
  }, [rawStatus]);

  // Data
  const {
    data: cases,
    isLoading: casesLoading,
    error: casesError,
    refetch: refetchCases,
  } = useRunCases(projectSlug, runId);

  const {
    data: resultsResponse,
    isLoading: resultsLoading,
    error: resultsError,
    refetch: refetchResults,
  } = useResults(projectSlug, runId);

  // Join cases + results
  const allRows: CaseRow[] = useMemo(() => {
    const caseList: RunCase[] = cases ?? [];
    const resultMap = new Map<string, ResultRow>(
      (resultsResponse?.data ?? []).map((r) => [r.case_id, r]),
    );

    return caseList.map((c) => {
      // The results API uses case_id (junction row id), not the content wombat_id.
      // RunCase.id is the junction id; content_id is the test-case content id.
      const result = resultMap.get(c.id) ?? resultMap.get(c.content_id) ?? null;

      // Derive display status
      let display_status: CaseDisplayStatus = "not_run";
      if (result) {
        display_status = result.status;
      }

      // Priority is not on RunCase from the current API shape; leave null.
      // When the API includes it (post-schema-regen) this can be wired up.
      return {
        id: c.id,
        wombat_id: c.wombat_id,
        title: c.title,
        position: c.position,
        priority: null,
        result,
        display_status,
      };
    });
  }, [cases, resultsResponse]);

  // Status counts (over all rows, before filter)
  const statusCounts: Record<CaseDisplayStatus, number> = useMemo(() => {
    const counts: Record<CaseDisplayStatus, number> = {
      pass: 0,
      fail: 0,
      blocked: 0,
      skipped: 0,
      not_run: 0,
    };
    for (const row of allRows) {
      counts[row.display_status] += 1;
    }
    return counts;
  }, [allRows]);

  // Apply status filter
  const filteredRows: CaseRow[] = useMemo(() => {
    if (activeStatuses.length === 0) return allRows;
    return allRows.filter((r) => activeStatuses.includes(r.display_status));
  }, [allRows, activeStatuses]);

  // Navigate to Runner focused on this case
  const handleRowClick = useCallback(
    (row: CaseRow) => {
      navigate(
        `/p/${projectSlug}/runs/${runId}/execute?case=${encodeURIComponent(row.wombat_id)}`,
      );
    },
    [navigate, projectSlug, runId],
  );

  // Status filter URL update
  const handleStatusFilterChange = useCallback(
    (next: CaseDisplayStatus[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.length === 0) {
            params.delete(STATUS_PARAM);
          } else {
            params.set(STATUS_PARAM, next.join(","));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Column definitions (stable reference — only changes if handleRowClick changes)
  const columns = useMemo(
    () => buildColumns(handleRowClick),
    [handleRowClick],
  );

  // ---------- Loading ----------
  if (casesLoading || resultsLoading) {
    return <RunCasesTableSkeleton />;
  }

  // ---------- Error ----------
  const error = casesError ?? resultsError;
  if (error) {
    return (
      <div className="p-4">
        <ErrorState
          error={error}
          title="Failed to load cases"
          onRetry={() => {
            void refetchCases();
            void refetchResults();
          }}
        />
      </div>
    );
  }

  // ---------- Empty (no cases at all) ----------
  if (allRows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
          title="No cases in this run"
          description="Add cases to this run via the run editor, or create a new run with a case selection."
        />
      </div>
    );
  }

  // ---------- Empty (filter produces no results) ----------
  const isFiltered = activeStatuses.length > 0;
  const showFilterEmpty = isFiltered && filteredRows.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Status filter chips */}
      <StatusFilterBar
        active={activeStatuses}
        counts={statusCounts}
        onChange={handleStatusFilterChange}
      />

      {/* Table or filtered-empty state */}
      {showFilterEmpty ? (
        <div className="p-4">
          <EmptyState
            icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
            title="No cases match the current filters"
            description="Remove one or more status filters to see all cases."
            action={
              <button
                type="button"
                onClick={() => handleStatusFilterChange([])}
                className={cn(
                  "text-xs font-medium underline underline-offset-2",
                  "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                )}
                style={{ color: "var(--accent-fg)" }}
              >
                Clear filters
              </button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <EntityTable<CaseRow>
            data={filteredRows}
            columns={columns}
            onRowClick={handleRowClick}
            getRowId={(row) => row.id}
            aria-label="Run cases"
            className="h-full"
          />
        </div>
      )}
    </div>
  );
}
