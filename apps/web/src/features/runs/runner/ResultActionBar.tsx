/**
 * ResultActionBar — the primary action surface at the bottom of FocusMode.
 *
 * Layout (left → right):
 *   [P] [F] [B] [S]   |   Notes   Attach   Bug URL
 *
 * Each result button is large, uses non-color indicators (icon + label + color),
 * and shows a subtle keyboard hint below the label.
 *
 * The bar receives callbacks from FocusMode so recording is centralised at the
 * page level (where useRecordWithConflictHandling lives).
 *
 * Sub-form panels (Notes, Attach, Bug URL, Reconcile) are wired in Task 50
 * and rendered as slot props here.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ResultStatus } from "../hooks/results";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultButtonDef {
  status: ResultStatus;
  label: string;
  shortcut: string;
  /** Lucide SVG path or simple shape — inline for zero-dependency */
  icon: ReactNode;
  fgVar: string;
  bgVar: string;
  activeBg: string;
}

// ---------------------------------------------------------------------------
// Result button definitions
// ---------------------------------------------------------------------------

const RESULT_BUTTONS: ResultButtonDef[] = [
  {
    status: "pass",
    label: "Pass",
    shortcut: "P",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M3.5 9.5L7 13L14.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    fgVar: "var(--result-pass-fg)",
    bgVar: "var(--result-pass-bg)",
    activeBg: "color-mix(in srgb, var(--result-pass-fg) 18%, var(--bg-surface-1))",
  },
  {
    status: "fail",
    label: "Fail",
    shortcut: "F",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M5 5L13 13M13 5L5 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    fgVar: "var(--result-fail-fg)",
    bgVar: "var(--result-fail-bg)",
    activeBg: "color-mix(in srgb, var(--result-fail-fg) 18%, var(--bg-surface-1))",
  },
  {
    status: "blocked",
    label: "Blocked",
    shortcut: "B",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4.5 4.5L13.5 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
    fgVar: "var(--result-blocked-fg)",
    bgVar: "var(--result-blocked-bg)",
    activeBg: "color-mix(in srgb, var(--result-blocked-fg) 18%, var(--bg-surface-1))",
  },
  {
    status: "skipped",
    label: "Skip",
    shortcut: "S",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M5 9H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M13 6L13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    fgVar: "var(--result-skipped-fg)",
    bgVar: "var(--result-skipped-bg)",
    activeBg: "color-mix(in srgb, var(--result-skipped-fg) 18%, var(--bg-surface-1))",
  },
];

// ---------------------------------------------------------------------------
// ResultButton
// ---------------------------------------------------------------------------

function ResultButton({
  def,
  onClick,
  isActive,
  isPending,
}: {
  def: ResultButtonDef;
  onClick: () => void;
  isActive: boolean;
  isPending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-pressed={isActive}
      aria-label={`Record ${def.label}`}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1",
        "rounded-xl px-5 py-3 min-w-[80px]",
        "border transition-all duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-[color:var(--focus-ring)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "active:scale-[0.96]",
      )}
      style={{
        color: def.fgVar,
        background: isActive ? def.activeBg : def.bgVar,
        borderColor: isActive
          ? `color-mix(in srgb, ${def.fgVar} 60%, transparent)`
          : `color-mix(in srgb, ${def.fgVar} 25%, transparent)`,
        boxShadow: isActive
          ? `0 0 0 1px color-mix(in srgb, ${def.fgVar} 40%, transparent)`
          : "none",
      }}
    >
      {def.icon}
      <span className="text-[13px] font-semibold leading-tight">{def.label}</span>
      {/* Keyboard hint */}
      <kbd
        className="absolute bottom-1.5 right-2 text-[9px] font-mono opacity-50"
        aria-hidden="true"
        style={{ color: "currentColor" }}
      >
        {def.shortcut}
      </kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function BarSeparator() {
  return (
    <div
      className="self-stretch w-px mx-2"
      style={{ background: "var(--border-default)" }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// ResultActionBar
// ---------------------------------------------------------------------------

interface ResultActionBarProps {
  /** Which status is the current result (if already recorded) */
  currentResult: ResultStatus | null;
  /** Whether a recording mutation is in flight */
  isPending: boolean;
  onPass: () => void;
  onFail: () => void;
  onBlock: () => void;
  onSkip: () => void;
  /** Slot: Notes sub-form (Task 50) */
  notesSlot?: ReactNode;
  /** Slot: Attach-evidence sub-form (Task 50) */
  attachSlot?: ReactNode;
  /** Slot: Bug-URL sub-form (Task 50) */
  bugUrlSlot?: ReactNode;
  /** Slot: Reconcile banner (Task 50) */
  reconcileSlot?: ReactNode;
  /** Which sub-panel is open, if any */
  activePanel: "notes" | "attach" | "bug" | null;
  onTogglePanel: (panel: "notes" | "attach" | "bug") => void;
}

export function ResultActionBar({
  currentResult,
  isPending,
  onPass,
  onFail,
  onBlock,
  onSkip,
  notesSlot,
  attachSlot,
  bugUrlSlot,
  reconcileSlot,
  activePanel,
  onTogglePanel,
}: ResultActionBarProps) {
  const handlers: Record<ResultStatus, () => void> = {
    pass: onPass,
    fail: onFail,
    blocked: onBlock,
    skipped: onSkip,
  };

  return (
    <div
      className="flex flex-col gap-0"
      role="toolbar"
      aria-label="Record result"
    >
      {/* Reconcile banner renders above the bar */}
      {reconcileSlot}

      {/* Sub-panel: active one expands above the bar */}
      {activePanel === "notes" && notesSlot && (
        <div
          className="border-t px-4 pt-3 pb-2"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
          }}
        >
          {notesSlot}
        </div>
      )}
      {activePanel === "attach" && attachSlot && (
        <div
          className="border-t px-4 pt-3 pb-2"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
          }}
        >
          {attachSlot}
        </div>
      )}
      {activePanel === "bug" && bugUrlSlot && (
        <div
          className="border-t px-4 pt-3 pb-2"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
          }}
        >
          {bugUrlSlot}
        </div>
      )}

      {/* Main bar */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-t"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* P / F / B / S buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {RESULT_BUTTONS.map((def) => (
            <ResultButton
              key={def.status}
              def={def}
              onClick={handlers[def.status]}
              isActive={currentResult === def.status}
              isPending={isPending}
            />
          ))}
        </div>

        <BarSeparator />

        {/* Sub-form toggles */}
        <div className="flex items-center gap-1">
          <PanelToggle
            label="Notes"
            shortcut="N"
            isActive={activePanel === "notes"}
            onClick={() => onTogglePanel("notes")}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M4.5 5.5H9.5M4.5 8H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            }
          />
          <PanelToggle
            label="Attach"
            shortcut="A"
            isActive={activePanel === "attach"}
            onClick={() => onTogglePanel("attach")}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M11.5 7.5L6 13C4.9 14.1 3.1 14.1 2 13C0.9 11.9 0.9 10.1 2 9L8 3C8.8 2.2 10 2.2 10.8 3C11.6 3.8 11.6 5 10.8 5.8L5 11.6C4.6 12 3.8 12 3.4 11.6C3 11.2 3 10.4 3.4 10L8.9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
          <PanelToggle
            label="Bug"
            shortcut="U"
            isActive={activePanel === "bug"}
            onClick={() => onTogglePanel("bug")}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 3C8.7 3 10 4.3 10 6V8C10 9.7 8.7 11 7 11C5.3 11 4 9.7 4 8V6C4 4.3 5.3 3 7 3Z" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2 6.5H4M10 6.5H12M4.5 3.5L3 2M9.5 3.5L11 2M7 11V13M4 8.5H2M10 8.5H12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            }
          />
        </div>

        {/* Pending indicator */}
        {isPending && (
          <div
            className="ml-auto h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
            style={{
              borderColor: "var(--border-strong)",
              borderTopColor: "transparent",
            }}
            aria-label="Recording…"
            role="status"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PanelToggle — small icon+label button for Notes / Attach / Bug
// ---------------------------------------------------------------------------

function PanelToggle({
  label,
  shortcut,
  isActive,
  onClick,
  icon,
}: {
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`${isActive ? "Close" : "Open"} ${label} panel`}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium",
        "border transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "focus-visible:ring-[color:var(--focus-ring)]",
      )}
      style={{
        background: isActive ? "var(--accent-soft)" : "var(--bg-surface-2)",
        color: isActive ? "var(--accent-fg)" : "var(--fg-muted)",
        borderColor: isActive
          ? "color-mix(in srgb, var(--accent-primary) 40%, transparent)"
          : "var(--border-default)",
      }}
    >
      {icon}
      <span>{label}</span>
      <kbd
        className="text-[9px] font-mono opacity-50 ml-0.5"
        aria-hidden="true"
      >
        {shortcut}
      </kbd>
    </button>
  );
}
