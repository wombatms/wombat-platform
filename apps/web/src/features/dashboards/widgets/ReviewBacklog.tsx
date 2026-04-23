/**
 * ReviewBacklog widget — count + 5 oldest pending proposals (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - The large count number is the hero of the widget — rendered in a
 *   tabular-nums display font at ~3xl scale with a muted "pending" label.
 *   When count is 0, the entire widget is the "all clear" empty state.
 * - Below the count: a compact list of 5 oldest proposals with an age badge
 *   (days) that deepens in color as age increases (yellow → amber → red).
 * - Each proposal row links to the approvals inbox detail page (SP3.2 route).
 * - Age badge is a non-color indicator too: the badge text itself is "Xd".
 */

import { Link, useParams } from "react-router-dom";
import { useWidget, type Scope, type Filters } from "../hooks";
import { WidgetFrame } from "../WidgetFrame";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BacklogProposal {
  id: string;
  kind: string;
  title: string;
  age_days: number;
}

interface ReviewBacklogData {
  count: number;
  oldest: BacklogProposal[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Age badge color: <3d = muted, 3–7d = warn, >7d = error */
function ageBadgeStyle(days: number): { color: string; background: string } {
  if (days > 7) {
    return { color: "var(--result-fail-fg)", background: "var(--result-fail-bg)" };
  }
  if (days >= 3) {
    return { color: "var(--result-blocked-fg)", background: "var(--result-blocked-bg)" };
  }
  return { color: "var(--fg-muted)", background: "var(--bg-surface-2)" };
}

const KIND_LABELS: Record<string, string> = {
  testcase: "TC",
  shared_step: "SS",
  story: "S",
  plan: "PL",
  suite: "SU",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReviewBacklogProps {
  scope: Scope;
  filters?: Filters;
}

export function ReviewBacklog({ scope, filters = {} }: ReviewBacklogProps) {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug ?? "";

  const { data, isLoading, error, refetch } = useWidget(
    slug,
    "review_backlog",
    scope,
    filters,
  );

  const backlogData = data as ReviewBacklogData | undefined;
  const count = backlogData?.count ?? 0;
  const oldest = backlogData?.oldest ?? [];
  const isEmpty = !isLoading && !error && count === 0;

  return (
    <WidgetFrame
      title="Review backlog"
      isLoading={isLoading}
      error={error}
      empty={isEmpty}
      emptyMessage="No pending proposals — inbox is clear."
      onRetry={() => void refetch()}
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Hero count row */}
        <div
          className="flex items-baseline gap-2 px-4 pt-3 pb-2 shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <Link
            to={`/p/${slug}/approvals`}
            className="flex items-baseline gap-2 group"
          >
            <span
              className="text-4xl font-bold tabular-nums leading-none group-hover:underline"
              style={{ color: count > 10 ? "var(--result-fail-fg)" : "var(--fg-default)" }}
            >
              {count}
            </span>
            <span
              className="text-xs font-medium"
              style={{ color: "var(--fg-muted)" }}
            >
              pending
            </span>
          </Link>
        </div>

        {/* Oldest proposals list */}
        {oldest.length > 0 && (
          <div className="flex flex-col flex-1 overflow-auto">
            {oldest.map((p) => {
              const ageBadge = ageBadgeStyle(p.age_days);
              return (
                <Link
                  key={p.id}
                  to={`/p/${slug}/approvals/${p.id}`}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2",
                    "hover:bg-[color:var(--bg-surface-2)] transition-colors",
                    "border-b last:border-b-0",
                  )}
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {/* Kind badge */}
                  <span
                    className="text-[9px] font-mono font-semibold px-1 rounded shrink-0 uppercase"
                    style={{
                      background: "var(--bg-surface-2)",
                      color: "var(--fg-muted)",
                    }}
                  >
                    {KIND_LABELS[p.kind] ?? p.kind.toUpperCase().slice(0, 2)}
                  </span>

                  {/* Title */}
                  <span
                    className="flex-1 text-xs truncate"
                    style={{ color: "var(--fg-default)" }}
                    title={p.title}
                  >
                    {p.title}
                  </span>

                  {/* Age badge */}
                  <span
                    className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full shrink-0"
                    style={ageBadge}
                  >
                    {p.age_days}d
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
