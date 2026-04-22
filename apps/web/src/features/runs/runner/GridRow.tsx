/**
 * GridRow — a single row in the Grid (Spreadsheet) runner view.
 *
 * Columns: # | wombat_id | title | priority | [P][F][B][S] | evidence | notes
 *
 * Design tone: dense monospace spreadsheet aesthetic. Each row is compact
 * (32px). The selected row gets a left accent rule + subtle highlight.
 * Result buttons use icon-only at this density with aria-labels.
 * Non-color indicators: icon + shape + color for results; dot presence for
 * evidence/notes indicators.
 */

import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { RunCaseWithSnapshot } from "./FocusMode";
import type { ResultRow, ResultStatus } from "../hooks/results";

// ---------------------------------------------------------------------------
// Result button configs
// ---------------------------------------------------------------------------

interface ResultConfig {
  status: ResultStatus;
  label: string;
  key: string;
  fgVar: string;
  bgVar: string;
  icon: React.ReactNode;
}

const RESULTS: ResultConfig[] = [
  {
    status: "pass",
    label: "Pass (P)",
    key: "P",
    fgVar: "var(--result-pass-fg)",
    bgVar: "var(--result-pass-bg)",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    status: "fail",
    label: "Fail (F)",
    key: "F",
    fgVar: "var(--result-fail-fg)",
    bgVar: "var(--result-fail-bg)",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M3 3L7 7M7 3L3 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    status: "blocked",
    label: "Blocked (B)",
    key: "B",
    fgVar: "var(--result-blocked-fg)",
    bgVar: "var(--result-blocked-bg)",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3 3L7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    status: "skipped",
    label: "Skip (S)",
    key: "S",
    fgVar: "var(--result-skipped-fg)",
    bgVar: "var(--result-skipped-bg)",
    icon: (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 3V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Priority chip
// ---------------------------------------------------------------------------

const PRIORITY_CFG: Record<
  string,
  { label: string; fgVar: string; bgVar: string }
> = {
  high: {
    label: "H",
    fgVar: "var(--priority-high-fg)",
    bgVar: "var(--priority-high-bg)",
  },
  med: {
    label: "M",
    fgVar: "var(--priority-med-fg)",
    bgVar: "var(--priority-med-bg)",
  },
  low: {
    label: "L",
    fgVar: "var(--priority-low-fg)",
    bgVar: "var(--priority-low-bg)",
  },
};

function PriorityChip({ priority }: { priority?: string | null }) {
  if (!priority) return <span style={{ color: "var(--fg-disabled)" }} aria-hidden="true">—</span>;
  const cfg = PRIORITY_CFG[priority.toLowerCase()] ?? PRIORITY_CFG["med"]!;
  const fgVar = cfg.fgVar;
  const bgVar = cfg.bgVar;
  const label = cfg.label;
  return (
    <span
      className="inline-flex items-center justify-center rounded px-1 text-[9px] font-bold uppercase"
      style={{
        color: fgVar,
        background: bgVar,
        minWidth: "16px",
        height: "16px",
      }}
      aria-label={`Priority: ${priority}`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// GridRow
// ---------------------------------------------------------------------------

export interface GridRowProps {
  /** 0-based index */
  index: number;
  case_: RunCaseWithSnapshot;
  result: ResultRow | null;
  isSelected: boolean;
  hasEvidence: boolean;
  onSelect: () => void;
  onRecord: (status: ResultStatus) => void;
  onOpen: () => void;
}

export const GridRow = memo(function GridRow({
  index,
  case_,
  result,
  isSelected,
  hasEvidence,
  onSelect,
  onRecord,
  onOpen,
}: GridRowProps) {
  const hasNotes = Boolean(result?.notes?.trim());
  const currentStatus = result?.status ?? null;

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't trigger select if user clicked a button
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      onSelect();
    },
    [onSelect],
  );

  const handleRowDoubleClick = useCallback(() => {
    onOpen();
  }, [onOpen]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
    [onOpen],
  );

  return (
    <div
      role="row"
      aria-rowindex={index + 2} /* 1 = header row */
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onKeyDown={handleRowKeyDown}
      className={cn(
        "relative flex items-center min-h-[32px] select-none cursor-default",
        "outline-none",
        "transition-colors duration-75",
        "group",
      )}
      style={{
        background: isSelected
          ? "color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface-1))"
          : "var(--bg-surface-1)",
        borderBottom: "1px solid var(--border-subtle)",
        /* Left accent for selected row */
        borderLeft: isSelected
          ? "2px solid var(--accent-primary)"
          : "2px solid transparent",
      }}
    >
      {/* Col: # (position) */}
      <div
        className="shrink-0 flex items-center justify-end px-2"
        style={{ width: "40px", color: "var(--fg-disabled)", fontSize: "10px", fontFamily: "monospace" }}
        aria-colindex={1}
      >
        {index + 1}
      </div>

      {/* Col: wombat_id */}
      <div
        className="shrink-0 px-2 font-mono"
        style={{ width: "88px", color: "var(--fg-muted)", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        aria-colindex={2}
        title={case_.wombat_id}
      >
        {case_.wombat_id}
      </div>

      {/* Col: title */}
      <div
        className="flex-1 min-w-0 px-2"
        style={{ fontSize: "12px", color: "var(--fg-default)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        aria-colindex={3}
        title={case_.title}
      >
        {case_.title}
      </div>

      {/* Col: priority */}
      <div
        className="shrink-0 flex items-center justify-center px-2"
        style={{ width: "40px" }}
        aria-colindex={4}
      >
        <PriorityChip priority={case_.snapshot.priority} />
      </div>

      {/* Col: P/F/B/S result buttons */}
      <div
        className="shrink-0 flex items-center gap-0.5 px-2"
        style={{ width: "108px" }}
        role="group"
        aria-label={`Record result for ${case_.wombat_id}`}
        aria-colindex={5}
      >
        {RESULTS.map((res) => {
          const isActive = currentStatus === res.status;
          return (
            <button
              key={res.status}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRecord(res.status);
              }}
              aria-pressed={isActive}
              aria-label={res.label}
              className={cn(
                "flex items-center justify-center rounded transition-all duration-75",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
                "active:scale-95",
              )}
              style={{
                width: "22px",
                height: "22px",
                color: isActive ? res.fgVar : "var(--fg-disabled)",
                background: isActive ? res.bgVar : "transparent",
                border: isActive
                  ? `1px solid color-mix(in srgb, ${res.fgVar} 35%, transparent)`
                  : "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.color = res.fgVar;
                  (e.currentTarget as HTMLButtonElement).style.background = `color-mix(in srgb, ${res.bgVar} 60%, transparent)`;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-disabled)";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }
              }}
            >
              {res.icon}
            </button>
          );
        })}
      </div>

      {/* Col: evidence indicator */}
      <div
        className="shrink-0 flex items-center justify-center px-2"
        style={{ width: "32px" }}
        aria-colindex={6}
        aria-label={hasEvidence ? "Has evidence" : "No evidence"}
      >
        {hasEvidence ? (
          <div
            className="rounded-full"
            style={{ width: "6px", height: "6px", background: "var(--feedback-info-fg)" }}
            title="Has evidence"
          />
        ) : (
          <div
            className="rounded-full"
            style={{ width: "6px", height: "6px", background: "var(--border-default)" }}
            title="No evidence"
          />
        )}
      </div>

      {/* Col: notes indicator */}
      <div
        className="shrink-0 flex items-center justify-center px-2"
        style={{ width: "32px" }}
        aria-colindex={7}
        aria-label={hasNotes ? "Has notes" : "No notes"}
      >
        {hasNotes ? (
          <div
            className="rounded-full"
            style={{ width: "6px", height: "6px", background: "var(--fg-muted)" }}
            title="Has notes"
          />
        ) : (
          <div
            className="rounded-full"
            style={{ width: "6px", height: "6px", background: "var(--border-subtle)" }}
            title="No notes"
          />
        )}
      </div>
    </div>
  );
});
