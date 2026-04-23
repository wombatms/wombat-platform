/**
 * ReleaseReadiness widget — execution + pass summary for a plan (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - Two "hero numbers" side-by-side: executed_pct (left) + pass_pct (right),
 *   each with a labelled axis and a thick arc indicator below the number.
 *   Simple, readable, no recharts needed — a stacked color bar is sufficient.
 * - Status bar: segmented horizontal bar showing by_status proportions
 *   (pass/fail/blocked/skipped/not_run). Each segment uses the corresponding
 *   result token. Labels appear on hover via title attributes.
 * - Blockers list below the bar: up to 5 blocked cases with status badge +
 *   case ID link.
 * - Project-scope with no plan_id: the hook returns a 400 which is caught
 *   here as a special "missing filter" empty state ("Pick a plan").
 *   We detect this by checking if `error` has `status === 400` or the
 *   message contains "plan_id required". On empty state, we show an
 *   EmptyCard with the CTA from the design spec.
 *
 * Note on WidgetMissingFilterError: Task 36 will introduce a typed error
 * class for this. Until it lands, we check the raw message / status field.
 * TODO(SP3.4 Task 36): import WidgetMissingFilterError and use instanceof check.
 */

import { Link, useParams } from "react-router-dom";
import { useWidget, type Scope, type Filters } from "../hooks";
import { WidgetFrame } from "../WidgetFrame";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ByStatus {
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  not_run: number;
}

interface Blocker {
  wombat_id: string;
  title: string;
  status: string;
}

interface ReadinessData {
  plan_id: string;
  plan_title: string;
  executed_pct: number;
  pass_pct: number;
  by_status: ByStatus;
  blockers: Blocker[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMissingFilterError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    // HTTP 400 or message containing "plan_id"
    if (e["status"] === 400) return true;
    if (typeof e["message"] === "string" && e["message"].includes("plan_id")) return true;
  }
  return false;
}

const STATUS_SEGMENT_CONFIG = [
  { key: "pass",    label: "Pass",    fg: "var(--result-pass-fg)",    bg: "var(--result-pass-bg)"    },
  { key: "fail",    label: "Fail",    fg: "var(--result-fail-fg)",    bg: "var(--result-fail-bg)"    },
  { key: "blocked", label: "Blocked", fg: "var(--result-blocked-fg)", bg: "var(--result-blocked-bg)" },
  { key: "skipped", label: "Skipped", fg: "var(--result-skipped-fg)", bg: "var(--result-skipped-bg)" },
  { key: "not_run", label: "Not run", fg: "var(--result-not_run-fg)", bg: "var(--result-not_run-bg)" },
] as const;

function StatusBar({ byStatus }: { byStatus: ByStatus }) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden gap-px" aria-label="Status breakdown">
      {STATUS_SEGMENT_CONFIG.map(({ key, label, bg }) => {
        const count = byStatus[key];
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={key}
            className="h-full transition-all duration-300"
            style={{ width: `${pct}%`, background: bg }}
            title={`${label}: ${count} (${Math.round(pct)}%)`}
            role="presentation"
          />
        );
      })}
    </div>
  );
}

function BigPct({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="text-3xl font-bold tabular-nums leading-none"
        style={{ color }}
      >
        {Math.round(value)}%
      </span>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        {label}
      </span>
    </div>
  );
}

const BLOCKER_STATUS_LABELS: Record<string, string> = {
  fail: "Fail",
  blocked: "Blocked",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReleaseReadinessProps {
  scope: Scope;
  filters?: Filters;
}

export function ReleaseReadiness({ scope, filters = {} }: ReleaseReadinessProps) {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug ?? "";

  // Project scope with no plan_id → anticipate a 400.
  // We pass the query through; if it errors with a "missing plan_id" signal,
  // we render the empty state rather than the error card.
  const needsPlanId = scope.kind === "project" && !filters.plan_id;

  const { data, isLoading, error, refetch } = useWidget(
    slug,
    "release_readiness",
    scope,
    filters,
  );

  // Missing plan_id on project scope → show empty "pick a plan" state,
  // not an error. We skip the fetch entirely when we know it will 400.
  const missingFilter = needsPlanId || isMissingFilterError(error);

  const readinessData = data as ReadinessData | undefined;
  const isEmpty = !isLoading && !error && !readinessData;

  const execColor =
    !readinessData
      ? "var(--fg-muted)"
      : readinessData.executed_pct >= 80
        ? "var(--result-pass-fg)"
        : readinessData.executed_pct >= 50
          ? "var(--result-blocked-fg)"
          : "var(--result-fail-fg)";

  const passColor =
    !readinessData
      ? "var(--fg-muted)"
      : readinessData.pass_pct >= 90
        ? "var(--result-pass-fg)"
        : readinessData.pass_pct >= 70
          ? "var(--result-blocked-fg)"
          : "var(--result-fail-fg)";

  // If project scope and no plan_id filter, emit empty state with CTA.
  if (missingFilter) {
    return (
      <WidgetFrame
        title="Release readiness"
        empty
        emptyMessage="Select a plan to view release readiness metrics."
      />
    );
  }

  return (
    <WidgetFrame
      title="Release readiness"
      isLoading={isLoading}
      error={error && !missingFilter ? error : undefined}
      empty={isEmpty}
      emptyMessage="No run data for this plan yet."
      onRetry={() => void refetch()}
    >
      <div className="flex flex-col gap-3 px-4 py-3 h-full overflow-auto">
        {/* Plan title */}
        {readinessData?.plan_title && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-[10px] uppercase tracking-wider shrink-0"
              style={{ color: "var(--fg-muted)" }}
            >
              Plan:
            </span>
            <Link
              to={`/p/${slug}/plans/${readinessData.plan_id}`}
              className="text-xs truncate hover:underline"
              style={{ color: "var(--accent-primary)" }}
              title={readinessData.plan_title}
            >
              {readinessData.plan_title}
            </Link>
          </div>
        )}

        {/* Hero numbers */}
        {readinessData && (
          <>
            <div className="flex items-center justify-around py-2">
              <BigPct value={readinessData.executed_pct} label="Executed" color={execColor} />
              <div
                className="w-px h-10 shrink-0"
                style={{ background: "var(--border-subtle)" }}
                aria-hidden="true"
              />
              <BigPct value={readinessData.pass_pct} label="Pass" color={passColor} />
            </div>

            {/* Status bar */}
            <div className="flex flex-col gap-1.5">
              <StatusBar byStatus={readinessData.by_status} />
              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {STATUS_SEGMENT_CONFIG.map(({ key, label, fg }) => {
                  const count = readinessData.by_status[key];
                  if (count === 0) return null;
                  return (
                    <span key={key} className="flex items-center gap-1 text-[10px]">
                      <span
                        className="inline-block w-2 h-2 rounded-sm shrink-0"
                        style={{ background: fg }}
                        aria-hidden="true"
                      />
                      <span style={{ color: "var(--fg-muted)" }}>
                        {label}: <span className="tabular-nums font-medium" style={{ color: "var(--fg-default)" }}>{count}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Blockers */}
            {readinessData.blockers.length > 0 && (
              <div className="flex flex-col gap-1">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--fg-subtle, var(--fg-muted))" }}
                >
                  Blockers ({readinessData.blockers.length})
                </span>
                {readinessData.blockers.slice(0, 5).map((b) => (
                  <div
                    key={b.wombat_id}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1 rounded-sm",
                      "text-xs",
                    )}
                    style={{ background: "var(--bg-surface-2)" }}
                  >
                    <span
                      className="text-[9px] font-semibold px-1 rounded shrink-0"
                      style={{
                        color: "var(--result-fail-fg)",
                        background: "var(--result-fail-bg)",
                      }}
                    >
                      {BLOCKER_STATUS_LABELS[b.status] ?? b.status}
                    </span>
                    <Link
                      to={`/p/${slug}/library/${b.wombat_id}`}
                      className="text-[10px] font-mono shrink-0 hover:underline"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      {b.wombat_id}
                    </Link>
                    <span
                      className="truncate text-[11px] flex-1"
                      style={{ color: "var(--fg-default)" }}
                      title={b.title}
                    >
                      {b.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </WidgetFrame>
  );
}
