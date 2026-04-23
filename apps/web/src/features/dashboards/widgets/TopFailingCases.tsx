/**
 * TopFailingCases widget — ranked table of most-failed test cases (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - Rank column uses a monospaced number in a muted pill — quick scan of
 *   the "worst offenders" ordering without heavy decoration.
 * - Failure count shown as a bold number + small "failures" label for
 *   semantic clarity; color scales from amber (low count) to red (high).
 * - last_failed_at rendered as relative time with ISO title attribute.
 * - Case IDs link to library detail page.
 * - Table body scrolls independently within the widget frame.
 */

import { Link, useParams } from "react-router-dom";
import { useWidget, type Scope, type Filters } from "../hooks";
import { WidgetFrame } from "../WidgetFrame";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FailingCase {
  wombat_id: string;
  title: string;
  failures: number;
  last_failed_at: string | null;
}

interface TopFailingData {
  cases: FailingCase[];
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

/** Failure count color: ≥10 → error, ≥5 → warning, else → muted */
function failureColor(count: number): string {
  if (count >= 10) return "var(--result-fail-fg)";
  if (count >= 5) return "var(--result-blocked-fg)";
  return "var(--fg-muted)";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TopFailingCasesProps {
  scope: Scope;
  filters?: Filters;
}

export function TopFailingCases({ scope, filters = {} }: TopFailingCasesProps) {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const slug = projectSlug ?? "";

  const { data, isLoading, error, refetch } = useWidget(
    slug,
    "top_failing_cases",
    scope,
    filters,
  );

  const failData = data as TopFailingData | undefined;
  const cases = failData?.cases ?? [];
  const isEmpty = !isLoading && !error && cases.length === 0;

  return (
    <WidgetFrame
      title="Top failing cases"
      isLoading={isLoading}
      error={error}
      empty={isEmpty}
      emptyMessage="No failures recorded in this window."
      onRetry={() => void refetch()}
    >
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse" role="table">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {["#", "Case", "Failures", "Last failed"].map((col) => (
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
              ))}
            </tr>
          </thead>
          <tbody>
            {cases.map((c, idx) => (
              <tr
                key={c.wombat_id}
                className="group hover:bg-[color:var(--bg-surface-2)] transition-colors"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {/* Rank */}
                <td className="px-3 py-2 w-8">
                  <span
                    className="text-[10px] font-mono tabular-nums"
                    style={{ color: "var(--fg-disabled)" }}
                  >
                    {idx + 1}
                  </span>
                </td>

                {/* Case ID + title */}
                <td className="px-3 py-2 max-w-[220px]">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <Link
                      to={`/p/${slug}/library/${c.wombat_id}`}
                      className="text-[10px] font-mono hover:underline shrink-0"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      {c.wombat_id}
                    </Link>
                    <span
                      className="truncate text-[11px]"
                      style={{ color: "var(--fg-default)" }}
                      title={c.title}
                    >
                      {c.title}
                    </span>
                  </div>
                </td>

                {/* Failure count */}
                <td className="px-3 py-2 w-24">
                  <span
                    className="font-semibold tabular-nums text-sm"
                    style={{ color: failureColor(c.failures) }}
                  >
                    {c.failures}
                  </span>
                  <span
                    className="ml-1 text-[9px] uppercase tracking-wide"
                    style={{ color: "var(--fg-disabled)" }}
                  >
                    {c.failures === 1 ? "failure" : "failures"}
                  </span>
                </td>

                {/* Last failed at */}
                <td
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ color: "var(--fg-muted)" }}
                  title={c.last_failed_at ?? undefined}
                >
                  {relativeTime(c.last_failed_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetFrame>
  );
}
