/**
 * FocusMode — full-screen single-case execution runner.
 *
 * No app chrome (no sidebar/header). Renders one CaseRenderer at a time,
 * driven by the `?case=<wombat_id>` URL param or sequential position.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Top strip: run title, case id, progress bar, nav    │  ← sticky
 *   ├─────────────────────────────────────────────────────┤
 *   │ Body: CaseRenderer (preconditions + steps)          │  ← scrollable
 *   ├─────────────────────────────────────────────────────┤
 *   │ ResultActionBar (P/F/B/S + sub-form slots)          │  ← sticky bottom
 *   └─────────────────────────────────────────────────────┘
 *
 * Keyboard shortcuts are handled by useRunnerKeyboard. On record success,
 * auto-advances to the next non-completed case.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Grid3x3,
  LayoutList,
  X,
  Zap,
} from "lucide-react";
import { RunProgressBar } from "../components/RunProgressBar";
import { CaseRenderer, type CaseSnapshot } from "./CaseRenderer";
import { ResultActionBar } from "./ResultActionBar";
import { GotoDropdown } from "./GotoDropdown";
import { ShortcutsOverlay } from "@/lib/shortcuts/ShortcutsOverlay";
import { useRunnerKeyboard } from "./useRunnerKeyboard";
import type { RunSummary, RunCase } from "../hooks/runs";
import type { ResultRow, ResultStatus } from "../hooks/results";
import type { ReconcileState } from "../lib/record";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot data per case — assembled by RunExecutePage from API responses */
export interface RunCaseWithSnapshot extends RunCase {
  snapshot: CaseSnapshot;
}

interface FocusModeProps {
  projectSlug: string;
  run: RunSummary;
  cases: RunCaseWithSnapshot[];
  /** Map of case wombat_id → ResultRow */
  results: Map<string, ResultRow>;
  /** Whether a recording mutation is in flight */
  isPending: boolean;
  reconcile: ReconcileState;
  onRecord: (status: ResultStatus, failedAtStep?: number) => void;
  onClearReconcile: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNextNonCompleted(
  cases: RunCaseWithSnapshot[],
  results: Map<string, ResultRow>,
  fromIndex: number,
): number {
  // Search forward, then wrap
  for (let i = fromIndex + 1; i < cases.length; i++) {
    const c = cases[i];
    if (c && !results.has(c.wombat_id)) return i;
  }
  // Try from the beginning
  for (let i = 0; i <= fromIndex; i++) {
    const c = cases[i];
    if (c && !results.has(c.wombat_id)) return i;
  }
  // All done — stay on current
  return fromIndex;
}

// ---------------------------------------------------------------------------
// TopStrip
// ---------------------------------------------------------------------------

function TopStrip({
  projectSlug,
  run,
  currentCase,
  position,
  total,
  onPrev,
  onNext,
  onGoto,
  onToggleView,
  onClose,
}: {
  projectSlug: string;
  run: RunSummary;
  currentCase: RunCaseWithSnapshot | null;
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onGoto: () => void;
  onToggleView: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  return (
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
          onClick={() =>
            navigate(`/p/${projectSlug}/runs/${run.id}`)
          }
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
        <div
          className="h-5 w-px shrink-0"
          style={{ background: "var(--border-default)" }}
          aria-hidden="true"
        />

        {/* Run title */}
        <span
          className="text-[12px] font-medium truncate max-w-[200px] hidden sm:block"
          style={{ color: "var(--fg-muted)" }}
          title={run.title}
        >
          {run.title}
        </span>

        {/* Case id + title */}
        {currentCase && (
          <>
            <div
              className="h-5 w-px shrink-0 hidden sm:block"
              style={{ background: "var(--border-default)" }}
              aria-hidden="true"
            />
            <div className="flex items-baseline gap-2 min-w-0 flex-1">
              <span
                className="text-[11px] font-mono shrink-0"
                style={{ color: "var(--fg-disabled)" }}
              >
                {currentCase.wombat_id}
              </span>
              <span
                className="text-[13px] font-semibold truncate"
                style={{ color: "var(--fg-default)" }}
              >
                {currentCase.title}
              </span>
            </div>
          </>
        )}

        {/* Right: position counter + nav */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Position counter */}
          <button
            type="button"
            onClick={onGoto}
            className={cn(
              "text-[11px] font-mono tabular-nums px-2 py-1 rounded",
              "hover:bg-[var(--bg-surface-2)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={{ color: "var(--fg-muted)" }}
            aria-label={`Case ${position} of ${total}. Press to go to case.`}
          >
            {position}/{total}
          </button>

          {/* Prev */}
          <button
            type="button"
            onClick={onPrev}
            disabled={position <= 1}
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded",
              "hover:bg-[var(--bg-surface-2)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              "disabled:opacity-30 disabled:cursor-not-allowed",
            )}
            aria-label="Previous case (←)"
            style={{ color: "var(--fg-muted)" }}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={onNext}
            disabled={position >= total}
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded",
              "hover:bg-[var(--bg-surface-2)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              "disabled:opacity-30 disabled:cursor-not-allowed",
            )}
            aria-label="Next case (→)"
            style={{ color: "var(--fg-muted)" }}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* View toggle */}
          <button
            type="button"
            onClick={onToggleView}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "hover:bg-[var(--bg-surface-2)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            aria-label="Switch to grid view (V)"
            style={{ color: "var(--fg-muted)" }}
          >
            <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Grid</span>
            <kbd
              className="text-[9px] font-mono opacity-50"
              aria-hidden="true"
            >
              V
            </kbd>
          </button>

          {/* Close / back to list */}
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "flex items-center justify-center h-7 w-7 rounded",
              "hover:bg-[var(--bg-surface-2)] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            aria-label="Close runner and return to run detail"
            style={{ color: "var(--fg-muted)" }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Progress bar row */}
      <div
        className="px-4 pb-2"
        style={{ background: "var(--bg-surface-1)" }}
      >
        <RunProgressBar run={run} countsOnly={false} className="max-w-none" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FocusMode
// ---------------------------------------------------------------------------

export function FocusMode({
  projectSlug,
  run,
  cases,
  results,
  isPending,
  reconcile,
  onRecord,
  onClearReconcile,
}: FocusModeProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive current case index from URL ?case= param or default to first non-completed
  const caseParam = searchParams.get("case");
  const [currentIdx, setCurrentIdx] = useState<number>(() => {
    if (caseParam) {
      const idx = cases.findIndex((c) => c.wombat_id === caseParam);
      if (idx >= 0) return idx;
    }
    // First non-completed
    const first = cases.findIndex((c) => !results.has(c.wombat_id));
    return first >= 0 ? first : 0;
  });

  // Sync index to URL
  useEffect(() => {
    const c = cases[currentIdx];
    if (c) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("case", c.wombat_id);
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // Also sync from URL to index when user navigates back/forward
  useEffect(() => {
    if (caseParam) {
      const idx = cases.findIndex((c) => c.wombat_id === caseParam);
      if (idx >= 0 && idx !== currentIdx) {
        setCurrentIdx(idx);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseParam]);

  const currentCase = cases[currentIdx] ?? null;
  const currentResult = currentCase
    ? (results.get(currentCase.wombat_id) ?? null)
    : null;

  // Sub-panel state
  const [activePanel, setActivePanel] = useState<"notes" | "attach" | "bug" | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const bugUrlRef = useRef<HTMLInputElement | null>(null);

  // Goto dropdown
  const [gotoOpen, setGotoOpen] = useState(false);

  // Help overlay
  const [helpOpen, setHelpOpen] = useState(false);

  // isCapturing: true while a text input inside the runner has focus
  const [isCapturing, setIsCapturing] = useState(false);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goPrev = useCallback(() => {
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentIdx((i) => Math.min(cases.length - 1, i + 1));
  }, [cases.length]);

  const goToCase = useCallback(
    (wombatId: string) => {
      const idx = cases.findIndex((c) => c.wombat_id === wombatId);
      if (idx >= 0) setCurrentIdx(idx);
    },
    [cases],
  );

  const toggleView = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", "grid");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const closeRunner = useCallback(() => {
    navigate(`/p/${projectSlug}/runs/${run.id}`);
  }, [navigate, projectSlug, run.id]);

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  const handleRecord = useCallback(
    (status: ResultStatus, failedAtStep?: number) => {
      onRecord(status, failedAtStep);
      // Auto-advance after a brief delay so the user sees the success state
      setTimeout(() => {
        if (currentIdx < cases.length - 1) {
          const nextIdx = findNextNonCompleted(cases, results, currentIdx);
          if (nextIdx !== currentIdx) {
            setCurrentIdx(nextIdx);
          }
        }
      }, 350);
    },
    [onRecord, currentIdx, cases, results],
  );

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  const togglePanel = useCallback(
    (panel: "notes" | "attach" | "bug") => {
      setActivePanel((prev) => {
        const next = prev === panel ? null : panel;
        // Auto-focus the relevant input when opening
        if (next === "notes") {
          requestAnimationFrame(() => notesRef.current?.focus());
        } else if (next === "bug") {
          requestAnimationFrame(() => bugUrlRef.current?.focus());
        }
        return next;
      });
    },
    [],
  );

  useRunnerKeyboard({
    onPass: () => handleRecord("pass"),
    onFail: () => handleRecord("fail"),
    onBlock: () => handleRecord("blocked"),
    onSkip: () => handleRecord("skipped"),
    onFailedAtStep: (step) => handleRecord("fail", step),
    onPrev: goPrev,
    onNext: goNext,
    onFocusNotes: () => {
      setActivePanel("notes");
      requestAnimationFrame(() => notesRef.current?.focus());
    },
    onAttach: () => togglePanel("attach"),
    onBugUrl: () => {
      setActivePanel("bug");
      requestAnimationFrame(() => bugUrlRef.current?.focus());
    },
    onToggleView: toggleView,
    onGoto: () => setGotoOpen(true),
    onShowHelp: () => setHelpOpen(true),
    isCapturing,
    enabled: !gotoOpen && !helpOpen,
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

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Top strip */}
      <TopStrip
        projectSlug={projectSlug}
        run={run}
        currentCase={currentCase}
        position={currentIdx + 1}
        total={cases.length}
        onPrev={goPrev}
        onNext={goNext}
        onGoto={() => setGotoOpen(true)}
        onToggleView={toggleView}
        onClose={closeRunner}
      />

      {/* Scrollable body */}
      <main
        className="flex-1 overflow-y-auto"
        id="runner-case-body"
        aria-label="Current test case"
      >
        {currentCase ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <CaseRenderer
              projectSlug={projectSlug}
              snapshot={currentCase.snapshot}
              position={currentIdx + 1}
            />
          </div>
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: "var(--fg-disabled)" }}
          >
            <p className="text-sm">Select a case to begin</p>
          </div>
        )}
      </main>

      {/* Sticky bottom action bar */}
      <div className="shrink-0">
        <ResultActionBar
          currentResult={currentResult?.status ?? null}
          isPending={isPending}
          onPass={() => handleRecord("pass")}
          onFail={() => handleRecord("fail")}
          onBlock={() => handleRecord("blocked")}
          onSkip={() => handleRecord("skipped")}
          activePanel={activePanel}
          onTogglePanel={togglePanel}
          reconcileSlot={
            reconcile.kind === "conflict" ? (
              <div
                className="px-4 py-2 border-t text-[12px]"
                style={{
                  background: "var(--feedback-warn-bg)",
                  borderColor: "var(--feedback-warn-fg)",
                  color: "var(--feedback-warn-fg)",
                }}
              >
                Conflict: another writer has recorded this case. Use the Reconcile banner to resolve.
                <button
                  type="button"
                  onClick={onClearReconcile}
                  className="ml-2 underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null
          }
        />
      </div>

      {/* Goto dropdown */}
      <GotoDropdown
        open={gotoOpen}
        onClose={() => setGotoOpen(false)}
        cases={cases}
        currentCaseId={currentCase?.wombat_id ?? null}
        onSelect={goToCase}
      />

      {/* Help overlay */}
      <ShortcutsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  );
}
