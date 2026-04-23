/**
 * PlansListPage — SP3.4 Task 42
 *
 * Design decisions (from frontend-design skill invocation):
 * - Utilitarian/editorial aesthetic: no decorative chrome, all signal from
 *   data density and subtle typographic hierarchy.
 * - Status pills use three non-color discriminators: shape (rounded-full),
 *   letter prefix prefix (D/A/Z) via aria-label, and color token — so the
 *   distinction is never color-alone.
 * - CaseCountCell fetches lazily via useResolvePlan — only fires when the
 *   plan row is rendered (TanStack Table passes row.original into the cell
 *   renderer, and the hook is called inside the cell component). While the
 *   resolve query is pending a skeleton pill renders; on error it falls back
 *   to "—". This avoids N parallel fetches on page load: rows are virtualized
 *   so only visible rows trigger resolve calls.
 * - "+" New plan button: primary action, uses accent-primary token.
 * - Skeleton: 5 rows that mirror column widths to avoid layout shift.
 * - Empty state: centered, two CTAs (create + import). Import YAML CTA is
 *   rendered with a TODO comment — the SP3.3 import endpoint is out of scope;
 *   it is included as a disabled button with aria-disabled so the copy lands
 *   but cannot be clicked. Follow-up: wire when the import endpoint exists.
 * - Route param: `projectSlug` (matches router.tsx `/p/:projectSlug/plans`).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EntityTable } from "@/components/shared/EntityTable";
import { ErrorState } from "@/components/shared/ErrorState";
import { useDensity } from "@/lib/density/useDensity";
import { cn } from "@/lib/utils";
import {
  usePlansList,
  useResolvePlan,
  type PlanSummary,
} from "./hooks";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable status from the PlanSummary.
 *
 * The backend does not have an explicit `status` field on plans in SP3.4 —
 * status is inferred from tags (convention: a plan tagged "archived" is
 * archived; one tagged "active" is active; otherwise "Draft").
 *
 * Follow-up: replace with an explicit status field when the backend adds it.
 */
type PlanStatus = "Draft" | "Active" | "Archived";

function derivePlanStatus(plan: PlanSummary): PlanStatus {
  const lower = plan.tags.map((t) => t.toLowerCase());
  if (lower.includes("archived")) return "Archived";
  if (lower.includes("active")) return "Active";
  return "Draft";
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<
  PlanStatus,
  { bg: string; fg: string; border: string; prefix: string }
> = {
  Draft: {
    bg: "var(--bg-surface-2)",
    fg: "var(--fg-muted)",
    border: "var(--border-default)",
    prefix: "D",
  },
  Active: {
    bg: "var(--feedback-success-bg)",
    fg: "var(--feedback-success-fg)",
    border: "var(--feedback-success-fg)",
    prefix: "A",
  },
  Archived: {
    bg: "var(--bg-surface-3)",
    fg: "var(--fg-disabled)",
    border: "var(--border-subtle)",
    prefix: "Z",
  },
};

function StatusPill({ status }: { status: PlanStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      aria-label={status}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      <span
        aria-hidden="true"
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold shrink-0"
        style={{ background: s.fg, color: s.bg }}
      >
        {s.prefix}
      </span>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CaseCountCell — lazy per-row resolve fetch
// ---------------------------------------------------------------------------

/**
 * Fetches the resolved case count for this plan via useResolvePlan.
 * Since this component is rendered inside a virtualized list, only visible
 * rows trigger the query. While pending: skeleton pill. On error: "—".
 */
function CaseCountCell({
  slug,
  wid,
}: {
  slug: string;
  wid: string;
}) {
  const { data, isLoading, isError } = useResolvePlan(slug, wid);

  if (isLoading) {
    return (
      <span
        className="inline-block h-4 w-8 rounded-full animate-pulse"
        aria-label="Loading case count"
        style={{ background: "var(--bg-surface-3)" }}
      />
    );
  }

  if (isError || data === undefined) {
    return (
      <span style={{ color: "var(--fg-disabled)" }} aria-label="Count unavailable">
        —
      </span>
    );
  }

  return (
    <span
      aria-label={`${data.total} cases`}
      className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums min-w-[2rem]"
      style={{
        background: "var(--bg-surface-2)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border-default)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {data.total.toLocaleString()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(slug: string): ColumnDef<PlanSummary>[] {
  return [
    {
      id: "wombat_id",
      header: "ID",
      accessorKey: "wombat_id",
      size: 160,
      cell: ({ getValue }) => (
        <span
          className="font-mono text-[12px] font-medium"
          style={{ color: "var(--accent-fg)" }}
        >
          {getValue<string>()}
        </span>
      ),
    },
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      size: 0,
      meta: { className: "flex-1 min-w-0" },
      cell: ({ getValue }) => (
        <span
          className="truncate text-[13px] font-medium"
          style={{ color: "var(--fg-default)" }}
        >
          {getValue<string>()}
        </span>
      ),
    },
    {
      id: "release",
      header: "Release",
      size: 140,
      cell: ({ row }) => {
        // Derive release from tags convention: tag prefixed "release:" or
        // "v" prefix. Fall back to "—" when absent.
        // Follow-up: use an explicit `release` field when the backend adds it.
        const release = row.original.tags.find(
          (t) => t.startsWith("release:") || /^v\d/.test(t),
        );
        if (!release) {
          return (
            <span style={{ color: "var(--fg-disabled)" }}>—</span>
          );
        }
        return (
          <span
            className="text-[12px]"
            style={{ color: "var(--fg-secondary)" }}
          >
            {release.startsWith("release:") ? release.slice(8) : release}
          </span>
        );
      },
    },
    {
      id: "case_count",
      header: "Cases",
      size: 88,
      cell: ({ row }) => (
        <CaseCountCell slug={slug} wid={row.original.wombat_id} />
      ),
    },
    {
      id: "last_run",
      header: "Last run",
      size: 120,
      cell: () => (
        // TODO(sp3.4): wire from runs list when "last run" is derivable.
        // The plan detail / list endpoints do not return last_run in SP3.4.
        <span style={{ color: "var(--fg-disabled)" }}>—</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 112,
      cell: ({ row }) => (
        <StatusPill status={derivePlanStatus(row.original)} />
      ),
    },
    {
      id: "updated_at",
      header: "Updated",
      accessorKey: "updated_at",
      size: 110,
      cell: ({ getValue }) => {
        const v = getValue<string | undefined>();
        if (!v) return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
        return (
          <span
            className="text-[12px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {new Date(v).toLocaleDateString()}
          </span>
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PlansListSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading plans">
      {/* Column header skeleton */}
      <div
        className="flex items-center px-3 border-b"
        style={{
          height: 34,
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-2)",
        }}
      >
        {[160, 0, 140, 88, 120, 112, 110].map((w, i) => (
          <div
            key={i}
            className="px-3"
            style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}
          >
            <div
              className="h-2.5 w-10 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center px-3 border-b"
          style={{ height: 36, borderColor: "var(--border-subtle)" }}
        >
          <div className="px-3" style={{ width: 160 }}>
            <div
              className="h-3 w-24 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
          <div className="flex-1 px-3">
            <div
              className="h-3 rounded animate-pulse"
              style={{
                background: "var(--bg-surface-3)",
                width: `${50 + (i % 3) * 15}%`,
              }}
            />
          </div>
          <div className="px-3" style={{ width: 140 }}>
            <div
              className="h-3 w-16 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
          <div className="px-3" style={{ width: 88 }}>
            <div
              className="h-4 w-8 rounded-full animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
          <div className="px-3" style={{ width: 120 }}>
            <div
              className="h-3 w-12 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
          <div className="px-3" style={{ width: 112 }}>
            <div
              className="h-5 w-16 rounded-full animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
          <div className="px-3" style={{ width: 110 }}>
            <div
              className="h-3 w-14 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlansEmptyState
// ---------------------------------------------------------------------------

function PlansEmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-20 gap-8">
      {/* Illustration area */}
      <div
        className="flex h-20 w-20 items-center justify-center rounded-2xl"
        style={{
          background: "var(--bg-surface-2)",
          border: "2px dashed var(--border-default)",
        }}
        aria-hidden="true"
      >
        <ClipboardList
          className="h-9 w-9"
          style={{ color: "var(--fg-disabled)" }}
        />
      </div>

      <div className="flex flex-col items-center gap-2 max-w-xs text-center">
        <h2
          className="text-[15px] font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          No plans yet
        </h2>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Plans group test cases for a release or sprint. Create one to
          start organizing your test runs.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onCreateClick}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold",
            "transition-colors duration-120 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            background: "var(--accent-primary)",
            color: "var(--fg-inverse)",
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create your first plan
        </button>

        {/* TODO(sp3.4 follow-up): wire when YAML import endpoint exists (SP3.3 scope).
            Rendered as disabled so the affordance is discoverable. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="YAML import coming soon"
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium",
            "opacity-40 cursor-not-allowed",
          )}
          style={{
            border: "1px solid var(--border-default)",
            background: "var(--bg-surface-2)",
            color: "var(--fg-muted)",
          }}
        >
          Import from YAML
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlansListPage
// ---------------------------------------------------------------------------

export function PlansListPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  const [density, setDensity, toggleDensity] = useDensity();
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const { data: plans, isLoading, isError, error, refetch } = usePlansList(projectSlug);

  // Memoize columns — they depend on `projectSlug` for the resolve hook
  const columns = buildColumns(projectSlug);

  // Keyboard: `d` toggles density, `n` navigates to new plan
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isEditing) return;

      if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
        toggleDensity();
        return;
      }
      if (e.key === "n" && !e.metaKey && !e.ctrlKey) {
        navigate(`/p/${projectSlug}/plans/new`);
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleDensity, navigate, projectSlug]);

  const handleRowClick = useCallback(
    (row: PlanSummary) => {
      setSelectedId(row.wombat_id);
      navigate(`/p/${projectSlug}/plans/${row.wombat_id}`);
    },
    [navigate, projectSlug],
  );

  const handleNewPlan = useCallback(() => {
    navigate(`/p/${projectSlug}/plans/new`);
  }, [navigate, projectSlug]);

  return (
    <div className="flex flex-col h-full" data-density={density}>
      <PageHeader
        title="Plans"
        count={isLoading ? undefined : (plans?.length ?? 0)}
        density={density}
        onDensityChange={setDensity}
        actions={
          <button
            type="button"
            onClick={handleNewPlan}
            aria-label="Create new plan"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold",
              "transition-colors duration-120 outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New plan
          </button>
        }
      />

      {isLoading ? (
        <PlansListSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !plans || plans.length === 0 ? (
        <PlansEmptyState onCreateClick={handleNewPlan} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <EntityTable
            data={plans}
            columns={columns}
            onRowClick={handleRowClick}
            selectedId={selectedId}
            density={density}
            getRowId={(row) => row.wombat_id}
            aria-label="Plans list"
            className="h-full"
          />
        </div>
      )}

      {/* Keyboard hint bar */}
      <div
        className="flex items-center gap-3 px-5 py-1.5 border-t text-[11px] shrink-0"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-2)",
          color: "var(--fg-disabled)",
        }}
      >
        <span>
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border-default)",
            }}
          >
            n
          </kbd>
          {" "}new plan
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border-default)",
            }}
          >
            d
          </kbd>
          {" "}density
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border-default)",
            }}
          >
            ↑↓
          </kbd>
          {" "}navigate
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border-default)",
            }}
          >
            ↵
          </kbd>
          {" "}open
        </span>
      </div>
    </div>
  );
}
