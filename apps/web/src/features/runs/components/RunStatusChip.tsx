import { cn } from "@/lib/utils";
import type { RunSummary } from "../hooks/runs";

/**
 * RunStatusChip — pill badge for run status.
 *
 * Uses the result design tokens from SP3.3:
 * - open (no results yet)  → result-not_run tokens
 * - open (results present) → result-not_run tokens (still in flight)
 * - closed / completed     → result-pass tokens
 * - closed / aborted       → result-blocked tokens
 *
 * Non-color cue: shape + icon ensures the status is distinguishable
 * without relying on colour alone (per spec §5 accessibility rule).
 */

export type RunStatus = Pick<RunSummary, "status" | "close_reason">;

interface RunStatusChipProps {
  status: RunSummary["status"];
  close_reason: RunSummary["close_reason"];
  /** sm = default compact pill; md = slightly taller for standalone use */
  size?: "sm" | "md";
  className?: string;
}

interface StatusConfig {
  label: string;
  fgVar: string;
  bgVar: string;
  /** SVG shape indicator (not relying on colour alone) */
  icon: React.ReactNode;
}

function getConfig(
  status: RunSummary["status"],
  close_reason: RunSummary["close_reason"],
): StatusConfig {
  if (status === "open") {
    return {
      label: "Open",
      fgVar: "var(--result-not_run-fg)",
      bgVar: "var(--result-not_run-bg)",
      icon: (
        /* Circle outline — "in progress" shape */
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    };
  }
  if (close_reason === "completed") {
    return {
      label: "Completed",
      fgVar: "var(--result-pass-fg)",
      bgVar: "var(--result-pass-bg)",
      icon: (
        /* Checkmark — "done/pass" shape */
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1.5 4L3 5.5L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    };
  }
  // aborted
  return {
    label: "Aborted",
    fgVar: "var(--result-blocked-fg)",
    bgVar: "var(--result-blocked-bg)",
    icon: (
      /* X mark — "blocked/aborted" shape */
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M2 2L6 6M6 2L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  };
}

export function RunStatusChip({
  status,
  close_reason,
  size = "sm",
  className,
}: RunStatusChipProps) {
  const config = getConfig(status, close_reason);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium shrink-0",
        size === "sm"
          ? "h-5 px-2 text-[10px] tracking-wide uppercase"
          : "h-6 px-2.5 text-[11px] tracking-wide uppercase",
        className,
      )}
      style={{
        color: config.fgVar,
        background: config.bgVar,
      }}
    >
      {config.icon}
      {config.label}
    </span>
  );
}
