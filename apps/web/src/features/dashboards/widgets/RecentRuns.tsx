/**
 * RecentRuns widget — compact table of the 10 most recent runs (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - Reuses RunStatusChip from SP3.3 for consistent status rendering.
 * - Pass rate rendered as a thin inline progress bar (CSS only, no chart
 *   lib) followed by the numeric value — bar gives immediate gestalt, number
 *   gives precision. Bar color maps to result tokens.
 * - Table rows link to the run detail page via react-router Link.
 * - Columns: Status · Title · Env · Started by · Pass rate · Finished.
 * - finished_at formatted as relative time (e.g., "2h ago") with the full
 *   ISO timestamp in a title attribute for hover.
 * - Overflow hidden with a fade at the bottom if the list exceeds the frame.
 *
 * Deferral note: SP3.3 does not export a `RunRow` component — it exports
 * RunsTable (TanStack Table) which is heavier than needed here. We inline
 * a lightweight row pattern instead. The deferred integration path: once
 * SP3.3 exports a composable RunRow, replace the `<tr>` block below.
 */

import { Link, useParams } from "react-router-dom";
import { RunStatusChip } from "@/features/runs/components/RunStatusChip";
import { useWidget, type Scope, type Filters } from "../hooks";
import { WidgetFrame } from "../WidgetFrame";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (backend widget shape)
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  name: string;
  status: "open" | "closed";
  close_reason: "completed" | "aborted" | null;
  pass_rate: number | null;
  env: string | null;
  started_by: string | null;
  finished_at: string | null;
}

interface RecentRunsData {
  runs: RunRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function PassRateBar({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
  const pct = Math.round(value * 100);
  const color =
    pct >= 90
      ? "var(--result-pass-fg)"
      : pct >= 60
        ? "var(--result-blocked-fg)"
        : "var(--result-fail-fg)";
  return (
    <div className="flex items-center gap-1.5 min-w-[70px]">
      <div
        className="h-1.5 rounded-full flex-1 overflow-hidden"
        style={{ background: "var(--bg-surface-2)" }}
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="text-[10px] tabular-nums shrink-0 w-8 text-right"
        style={{ color }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecentRunsProps {
  scope: Scope;
  filters?: Filters;
}

export function RecentRuns({ scope, filters = {} }: RecentRunsProps) {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug ?? "";

  const { data, isLoading, error, refetch } = useWidget(
    slug,
    "recent_runs",
    scope,
    filters,
  );

  const runsData = data as RecentRunsData | undefined;
  const runs = runsData?.runs ?? [];
  const isEmpty = !isLoading && !error && runs.length === 0;

  return (
    <WidgetFrame
      title="Recent runs"
      isLoading={isLoading}
      error={error}
      empty={isEmpty}
      emptyMessage="No runs yet. Create a run to start tracking results."
      onRetry={() => void refetch()}
    >
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse" role="table">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {["Status", "Title", "Env", "Started by", "Pass rate", "Finished"].map(
                (col) => (
                  <th
                    key={col}
                    className={cn(
                      "px-3 py-2 text-left font-semibold sticky top-0",
                      "uppercase tracking-wider text-[10px]",
                    )}
                    style={{
                      color: "var(--fg-muted)",
                      background: "var(--bg-surface-1)",
                    }}
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                className="group hover:bg-[color:var(--bg-surface-2)] transition-colors"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <td className="px-3 py-1.5">
                  <RunStatusChip
                    status={run.status}
                    close_reason={run.close_reason}
                  />
                </td>
                <td className="px-3 py-1.5 max-w-[200px]">
                  <Link
                    to={`/p/${slug}/runs/${run.id}`}
                    className="truncate block hover:underline"
                    style={{ color: "var(--accent-primary)" }}
                  >
                    {run.name}
                  </Link>
                </td>
                <td className="px-3 py-1.5" style={{ color: "var(--fg-muted)" }}>
                  {run.env ?? "—"}
                </td>
                <td className="px-3 py-1.5" style={{ color: "var(--fg-muted)" }}>
                  {run.started_by ?? "—"}
                </td>
                <td className="px-3 py-1.5">
                  <PassRateBar value={run.pass_rate} />
                </td>
                <td
                  className="px-3 py-1.5 whitespace-nowrap"
                  style={{ color: "var(--fg-muted)" }}
                  title={run.finished_at ?? undefined}
                >
                  {relativeTime(run.finished_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetFrame>
  );
}
