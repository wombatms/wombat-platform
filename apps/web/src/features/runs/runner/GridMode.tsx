/**
 * GridMode — dense spreadsheet view of all cases in a run.
 *
 * Activated by ?view=grid. Reuses useRunnerKeyboard with ↑/↓ for row
 * navigation and all standard P/F/B/S shortcuts scoped to the selected row.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Top strip (same as FocusMode but with "Focus" toggle│  ← sticky
 *   ├─────────────────────────────────────────────────────┤
 *   │ Column header bar                                   │  ← sticky
 *   ├─────────────────────────────────────────────────────┤
 *   │ Virtualised rows (useVirtualizer)                   │  ← scrollable
 *   └─────────────────────────────────────────────────────┘
 *
 * Virtualizer: @tanstack/react-virtual. Each row is 32px tall.
 * The selected row is always scrolled into view on keyboard navigation.
 *
 * On `v` or the Focus toggle button: switches back to ?view=focus while
 * preserving ?case=<selected_wombat_id> so FocusMode opens on the same case.
 *
 * IMPORTANT: This file MUST NOT import FocusMode (code-split invariant).
 * RunExecutePage routes between the two; they never import each other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  ArrowRight,
  LayoutList,
  X,
  Zap,
} from "lucide-react";
import { GridRow } from "./GridRow";
import { ShortcutsOverlay } from "@/lib/shortcuts/ShortcutsOverlay";
import { useRunnerKeyboard } from "./useRunnerKeyboard";
import { RunProgressBar } from "../components/RunProgressBar";
import type { RunCaseWithSnapshot } from "./FocusMode";
import type { RunSummary } from "../hooks/runs";
import type { ResultRow, ResultStatus, BugLink } from "../hooks/results";
import type { ReconcileState } from "../lib/record";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 28;

interface GridModeProps {
  projectSlug: string;
  run: RunSummary;
  cases: RunCaseWithSnapshot[];
  /** Map of case wombat_id → ResultRow */
  results: Map<string, ResultRow>;
  /** Map of case wombat_id → has-evidence boolean (pre-computed by parent) */
  evidenceMap: Map<string, boolean>;
  isPending: boolean;
  reconcile: ReconcileState;
  onRecord: (
    status: ResultStatus,
    failedAtStep?: number,
    notes?: string | null,
    bugLinks?: BugLink[],
  ) => void;
  /** Called with the case index (0-based) when recording should target that case */
  onSelectCase: (idx: number) => void;
  onClearReconcile: () => void;
}

// ---------------------------------------------------------------------------
// Column header bar
// ---------------------------------------------------------------------------

function ColumnHeader() {
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="flex items-center shrink-0"
      style={{
        height: `${HEADER_HEIGHT}px`,
        background: "var(--bg-surface-2)",
        borderBottom: "1px solid var(--border-default)",
        borderLeft: "2px solid transparent", // aligns with row left-rule
      }}
    >
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ width: "40px", color: "var(--fg-disabled)" }}
        aria-colindex={1}
      >
        #
      </div>
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ width: "88px", color: "var(--fg-muted)" }}
        aria-colindex={2}
      >
        ID
      </div>
      <div
        className="flex-1 min-w-0 px-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--fg-muted)" }}
        aria-colindex={3}
      >
        Title
      </div>
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider text-center"
        style={{ width: "40px", color: "var(--fg-disabled)" }}
        aria-colindex={4}
      >
        Pri
      </div>
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ width: "108px", color: "var(--fg-muted)" }}
        aria-colindex={5}
      >
        Result
      </div>
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider text-center"
        style={{ width: "32px", color: "var(--fg-disabled)" }}
        title="Evidence"
        aria-label="Evidence indicator column"
        aria-colindex={6}
      >
        Ev
      </div>
      <div
        className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider text-center"
        style={{ width: "32px", color: "var(--fg-disabled)" }}
        title="Notes"
        aria-label="Notes indicator column"
        aria-colindex={7}
      >
        N
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GridMode
// ---------------------------------------------------------------------------

export function GridMode({
  projectSlug,
  run,
  cases,
  results,
  evidenceMap,
  isPending: _isPending,
  reconcile: _reconcile,
  onRecord,
  onSelectCase,
  onClearReconcile: _onClearReconcile,
}: GridModeProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive initial selected row from URL ?case= param
  const caseParam = searchParams.get("case");
  const [selectedIdx, setSelectedIdx] = useState<number>(() => {
    if (caseParam) {
      const idx = cases.findIndex((c) => c.wombat_id === caseParam);
      if (idx >= 0) return idx;
    }
    return 0;
  });

  const [helpOpen, setHelpOpen] = useState(false);

  // Virtualizer
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Keep selected row in view
  useEffect(() => {
    if (cases.length > 0) {
      virtualizer.scrollToIndex(selectedIdx, { align: "auto" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  // Sync URL when selection changes
  useEffect(() => {
    const c = cases[selectedIdx];
    if (c) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("case", c.wombat_id);
          return next;
        },
        { replace: true },
      );
      onSelectCase(selectedIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx]);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goPrev = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setSelectedIdx((i) => Math.min(cases.length - 1, i + 1));
  }, [cases.length]);

  const goPrevRow = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNextRow = useCallback(() => {
    setSelectedIdx((i) => Math.min(cases.length - 1, i + 1));
  }, [cases.length]);

  const switchToFocus = useCallback(() => {
    const c = cases[selectedIdx];
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", "focus");
        if (c) next.set("case", c.wombat_id);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, cases, selectedIdx]);

  const closeRunner = useCallback(() => {
    navigate(`/p/${projectSlug}/runs/${run.id}`);
  }, [navigate, projectSlug, run.id]);

  // ---------------------------------------------------------------------------
  // Record for the currently selected case
  // ---------------------------------------------------------------------------

  const handleRecordSelected = useCallback(
    (status: ResultStatus) => {
      const c = cases[selectedIdx];
      if (!c) return;
      onRecord(status);
      // Auto-advance to next non-completed after recording
      setTimeout(() => {
        const nextIdx = cases.findIndex(
          (tc, i) => i > selectedIdx && !results.has(tc.wombat_id),
        );
        if (nextIdx >= 0) {
          setSelectedIdx(nextIdx);
        }
      }, 200);
    },
    [cases, selectedIdx, onRecord, results],
  );

  // ---------------------------------------------------------------------------
  // Keyboard — ↑/↓ navigate rows, P/F/B/S act on selected row
  // ---------------------------------------------------------------------------

  useRunnerKeyboard({
    onPass: () => handleRecordSelected("pass"),
    onFail: () => handleRecordSelected("fail"),
    onBlock: () => handleRecordSelected("blocked"),
    onSkip: () => handleRecordSelected("skipped"),
    onFailedAtStep: () => handleRecordSelected("fail"),
    onPrev: goPrev,
    onNext: goNext,
    onPrevRow: goPrevRow,
    onNextRow: goNextRow,
    onFocusNotes: () => {/* Notes inline editing not in grid mode */},
    onAttach: () => {/* Attach not directly in grid mode */},
    onBugUrl: () => {/* Bug URL not directly in grid mode */},
    onToggleView: switchToFocus,
    onGoto: () => {/* Goto in grid: handled by keyboard nav */},
    onShowHelp: () => setHelpOpen(true),
    isCapturing: false,
    enabled: !helpOpen,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (cases.length === 0) {
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-4"
        style={{ background: "var(--bg-app)", color: "var(--fg-default)" }}
      >
        <LayoutList className="h-10 w-10" style={{ color: "var(--fg-disabled)" }} aria-hidden="true" />
        <p className="text-sm font-medium" style={{ color: "var(--fg-muted)" }}>
          No cases in this run
        </p>
        <button
          type="button"
          onClick={closeRunner}
          className="text-xs underline"
          style={{ color: "var(--accent-primary)" }}
        >
          Back to run detail
        </button>
      </div>
    );
  }

  const selectedCase = cases[selectedIdx];

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Top strip */}
      <div
        className="sticky top-0 z-20 flex flex-col gap-0"
        style={{
          background: "var(--bg-surface-1)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {/* Main strip row */}
        <div className="flex items-center gap-3 px-4 py-2.5 min-h-[48px]">
          {/* Brand / back */}
          <button
            type="button"
            onClick={() => navigate(`/p/${projectSlug}/runs/${run.id}`)}
            className="flex items-center gap-1.5 shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Back to run detail"
            style={{ color: "var(--fg-muted)" }}
          >
            <Zap className="h-4 w-4" aria-hidden="true" style={{ color: "var(--accent-primary)" }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider hidden sm:inline">
              Runner
            </span>
          </button>

          {/* Divider */}
          <div className="h-5 w-px shrink-0" style={{ background: "var(--border-default)" }} aria-hidden="true" />

          {/* Run title */}
          <span
            className="text-[12px] font-medium truncate max-w-[200px] hidden sm:block"
            style={{ color: "var(--fg-muted)" }}
            title={run.title}
          >
            {run.title}
          </span>

          {/* Right side controls */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Row indicator */}
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: "var(--fg-muted)" }}
              aria-label={`Row ${selectedIdx + 1} of ${cases.length} selected`}
            >
              {selectedIdx + 1}/{cases.length}
            </span>

            {/* Up/down hint */}
            <span
              className="text-[10px] hidden sm:inline"
              style={{ color: "var(--fg-disabled)" }}
              aria-hidden="true"
            >
              ↑↓ navigate
            </span>

            {/* Switch to Focus */}
            <button
              type="button"
              onClick={switchToFocus}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                "hover:bg-[var(--bg-surface-2)] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              )}
              aria-label="Switch to focus view (V)"
              style={{ color: "var(--fg-muted)" }}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Focus</span>
              <kbd className="text-[9px] font-mono opacity-50" aria-hidden="true">V</kbd>
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={closeRunner}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded",
                "hover:bg-[var(--bg-surface-2)] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              )}
              aria-label="Close runner"
              style={{ color: "var(--fg-muted)" }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Progress bar row */}
        <div className="px-4 pb-2" style={{ background: "var(--bg-surface-1)" }}>
          <RunProgressBar run={run} countsOnly={false} className="max-w-none" />
        </div>
      </div>

      {/* Selected case mini-header */}
      {selectedCase && (
        <div
          className="px-4 py-1.5 flex items-center gap-2 shrink-0"
          style={{
            background: "var(--bg-surface-2)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <ArrowRight
            className="h-3 w-3 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--accent-primary)" }}
          />
          <span
            className="text-[10px] font-mono"
            style={{ color: "var(--fg-muted)" }}
          >
            {selectedCase.wombat_id}
          </span>
          <span
            className="text-[12px] font-medium truncate flex-1 min-w-0"
            style={{ color: "var(--fg-default)" }}
          >
            {selectedCase.title}
          </span>
          <span
            className="text-[10px] shrink-0"
            style={{ color: "var(--fg-disabled)" }}
            aria-hidden="true"
          >
            P · F · B · S to record
          </span>
        </div>
      )}

      {/* Column headers */}
      <div
        className="shrink-0"
        role="rowgroup"
        aria-label="Column headers"
      >
        <ColumnHeader />
      </div>

      {/* Virtualised rows */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        role="grid"
        aria-label="Test cases"
        aria-rowcount={cases.length + 1} /* +1 for header */
        aria-colcount={7}
        style={{ background: "var(--bg-surface-1)" }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const c = cases[virtualRow.index];
            if (!c) return null;
            const result = results.get(c.wombat_id) ?? null;
            const hasEvidence = evidenceMap.get(c.wombat_id) ?? false;

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <GridRow
                  index={virtualRow.index}
                  case_={c}
                  result={result}
                  isSelected={virtualRow.index === selectedIdx}
                  hasEvidence={hasEvidence}
                  onSelect={() => setSelectedIdx(virtualRow.index)}
                  onRecord={(status) => {
                    setSelectedIdx(virtualRow.index);
                    handleRecordSelected(status);
                  }}
                  onOpen={() => {
                    setSelectedIdx(virtualRow.index);
                    // Open this case in Focus mode
                    const caseId = c.wombat_id;
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.set("view", "focus");
                        next.set("case", caseId);
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: keyboard hint bar */}
      <div
        className="shrink-0 flex items-center gap-4 px-4 py-2 border-t"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
        aria-hidden="true"
      >
        {[
          ["↑↓", "navigate rows"],
          ["P", "pass"],
          ["F", "fail"],
          ["B", "blocked"],
          ["S", "skip"],
          ["↵", "open in focus"],
          ["V", "focus mode"],
          ["?", "help"],
        ].map(([key, desc]) => (
          <span
            key={key}
            className="flex items-center gap-1 text-[10px]"
            style={{ color: "var(--fg-disabled)" }}
          >
            <kbd
              className="font-mono px-1 py-0.5 rounded text-[9px]"
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-muted)",
              }}
            >
              {key}
            </kbd>
            {desc}
          </span>
        ))}
      </div>

      {/* Help overlay */}
      <ShortcutsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
