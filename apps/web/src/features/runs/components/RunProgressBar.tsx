import { cn } from "@/lib/utils";
import type { RunSummary } from "../hooks/runs";

/**
 * RunProgressBar — horizontal progress track + inline result counts.
 *
 * Visual:
 *   [=====pass=====|=fail=|=blk|=skip] ✓4 ✗2 ⊘1 —1 •8
 *                                       pass fail blk skip total
 *
 * When total_cases is 0 or undefined the bar renders a muted "no cases" state.
 * Non-color indicators: each segment uses both colour AND width proportion;
 * the count icons (✓ ✗ ⊘ —) provide shape-based discrimination.
 */

interface RunProgressBarProps {
  run: Pick<
    RunSummary,
    "total_cases" | "passed" | "failed" | "blocked" | "skipped" | "not_run"
  >;
  className?: string;
  /** When true, suppress the count labels (for very compact rows) */
  countsOnly?: boolean;
}

interface Segment {
  key: string;
  count: number;
  fgVar: string;
  bgVar: string;
  icon: string;
  label: string;
}

function buildSegments(
  run: RunProgressBarProps["run"],
): Segment[] {
  return [
    {
      key: "pass",
      count: run.passed ?? 0,
      fgVar: "var(--result-pass-fg)",
      bgVar: "var(--result-pass-bg)",
      icon: "✓",
      label: "passed",
    },
    {
      key: "fail",
      count: run.failed ?? 0,
      fgVar: "var(--result-fail-fg)",
      bgVar: "var(--result-fail-bg)",
      icon: "✗",
      label: "failed",
    },
    {
      key: "blocked",
      count: run.blocked ?? 0,
      fgVar: "var(--result-blocked-fg)",
      bgVar: "var(--result-blocked-bg)",
      icon: "⊘",
      label: "blocked",
    },
    {
      key: "skipped",
      count: run.skipped ?? 0,
      fgVar: "var(--result-skipped-fg)",
      bgVar: "var(--result-skipped-bg)",
      icon: "—",
      label: "skipped",
    },
  ];
}

export function RunProgressBar({
  run,
  className,
  countsOnly = false,
}: RunProgressBarProps) {
  const total = run.total_cases ?? 0;
  const segments = buildSegments(run);
  const completed = segments.reduce((s, seg) => s + seg.count, 0);
  const active = segments.filter((seg) => seg.count > 0);

  if (total === 0) {
    return (
      <span
        className={cn("text-[11px] tabular-nums", className)}
        style={{ color: "var(--fg-disabled)" }}
      >
        No cases
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {/* Progress track */}
      {!countsOnly && (
        <div
          className="relative h-[5px] flex-1 min-w-[40px] max-w-[80px] overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-label={`${completed} of ${total} cases complete`}
          style={{ background: "var(--bg-surface-3)" }}
        >
          {/* Segments rendered left-to-right by proportion */}
          {active.map((seg) => {
            const width = (seg.count / total) * 100;
            return (
              <div
                key={seg.key}
                className="absolute top-0 bottom-0"
                style={{
                  width: `${width}%`,
                  background: seg.bgVar,
                  /* each segment's left offset = sum of previous proportions */
                  // This approach resets per segment; use a cumulative layout instead
                }}
              />
            );
          })}
          {/* Cumulative bar (repaints over the above) */}
          <SegmentedBar segments={active} total={total} />
        </div>
      )}

      {/* Count labels */}
      <div
        className="flex items-center gap-1.5 text-[11px] tabular-nums shrink-0"
        aria-hidden="true"
      >
        {segments
          .filter((seg) => seg.count > 0)
          .map((seg) => (
            <span
              key={seg.key}
              title={`${seg.count} ${seg.label}`}
              style={{ color: seg.fgVar }}
            >
              {seg.icon}
              {seg.count}
            </span>
          ))}
        {/* Total / not-run hint */}
        {(run.not_run ?? 0) > 0 && (
          <span
            title={`${run.not_run} not run`}
            style={{ color: "var(--fg-disabled)" }}
          >
            •{run.not_run}
          </span>
        )}
      </div>
    </div>
  );
}

/* Segmented bar — renders coloured fills as absolute strips in order */
function SegmentedBar({
  segments,
  total,
}: {
  segments: Segment[];
  total: number;
}) {
  let accumulated = 0;

  return (
    <>
      {segments.map((seg) => {
        const left = (accumulated / total) * 100;
        const width = (seg.count / total) * 100;
        accumulated += seg.count;
        return (
          <div
            key={seg.key}
            className="absolute top-0 bottom-0"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: seg.fgVar,
              opacity: 0.85,
            }}
          />
        );
      })}
    </>
  );
}
