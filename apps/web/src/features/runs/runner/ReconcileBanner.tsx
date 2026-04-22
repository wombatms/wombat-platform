/**
 * ReconcileBanner — renders when a 409 conflict is detected during result recording.
 *
 * Shows:
 *   "{Author name} recorded this case {N} seconds ago as {status}."
 *   Two action buttons:
 *     "Overwrite" — re-records with the current user's intended payload using
 *                   the server's latest revision (If-Match: <currentRevision>).
 *     "Keep theirs" — updates local state to the server's value and moves on.
 *
 * Design: high-contrast warning banner that docks above the action bar.
 * The status of the other writer is shown with the same result chip tokens
 * used throughout the runner for visual coherence.
 *
 * Does NOT auto-advance on either action — the parent (FocusMode) decides
 * what to do after reconciliation.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, RefreshCw, ArrowRight } from "lucide-react";
import { useUpdateResult } from "../hooks/results";
import { cn } from "@/lib/utils";
import type { ReconcileState } from "../lib/record";
import type { ResultStatus } from "../hooks/results";

// ---------------------------------------------------------------------------
// Status label helpers (same tokens as RunProgressBar)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ResultStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "Skipped",
};

const STATUS_FG: Record<ResultStatus, string> = {
  pass: "var(--result-pass-fg)",
  fail: "var(--result-fail-fg)",
  blocked: "var(--result-blocked-fg)",
  skipped: "var(--result-skipped-fg)",
};

const STATUS_BG: Record<ResultStatus, string> = {
  pass: "var(--result-pass-bg)",
  fail: "var(--result-fail-bg)",
  blocked: "var(--result-blocked-bg)",
  skipped: "var(--result-skipped-bg)",
};

function StatusChip({ status }: { status: ResultStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        color: STATUS_FG[status],
        background: STATUS_BG[status],
        border: `1px solid color-mix(in srgb, ${STATUS_FG[status]} 30%, transparent)`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// ReconcileBanner
// ---------------------------------------------------------------------------

interface ReconcileBannerProps {
  reconcile: ReconcileState & { kind: "conflict" };
  projectSlug: string;
  runId: string;
  onResolved: (newStatus: ResultStatus | null) => void;
  onDismiss: () => void;
}

export function ReconcileBanner({
  reconcile,
  projectSlug,
  runId,
  onResolved,
  onDismiss,
}: ReconcileBannerProps) {
  const [phase, setPhase] = useState<"idle" | "overwriting" | "keeping">("idle");

  const updateMutation = useUpdateResult(projectSlug, runId);

  // "Overwrite" — PUT with If-Match: currentRevision, using the caller's original payload
  const handleOverwrite = useCallback(async () => {
    setPhase("overwriting");
    try {
      const { mine, currentRevision } = reconcile;
      await updateMutation.mutateAsync({
        caseId: mine.case_id,
        revision: currentRevision,
        body: {
          status: mine.status,
          notes: mine.notes ?? null,
          failed_at_step: mine.failed_at_step ?? null,
          bug_links: (mine.bug_links ?? []) as Array<{ url: string; title?: string | null; note?: string | null }>,
          duration_ms: mine.duration_ms ?? null,
        },
      });
      onResolved(mine.status);
    } catch {
      // If the overwrite also conflicts, the hook will surface a new error.
      setPhase("idle");
    }
  }, [reconcile, updateMutation, onResolved]);

  // "Keep theirs" — accept the server's value, update local state, move on
  const handleKeepTheirs = useCallback(() => {
    setPhase("keeping");
    // A brief delay so the user sees the "keeping" state before it clears
    setTimeout(() => {
      onResolved(reconcile.theirs.status);
    }, 200);
  }, [reconcile, onResolved]);

  const otherStatus = reconcile.theirs.status as ResultStatus;
  const recordedAt = reconcile.theirs.updated_at ?? reconcile.theirs.created_at;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-3 px-4 py-3 border-t"
      style={{
        background: "var(--feedback-warn-bg)",
        borderColor: "var(--feedback-warn-fg)",
        borderTopWidth: "2px",
        borderTopStyle: "solid",
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="h-4 w-4 shrink-0 mt-0.5"
          aria-hidden="true"
          style={{ color: "var(--feedback-warn-fg)" }}
        />
        <div className="flex-1 min-w-0">
          <p
            className="text-[12px] font-semibold leading-tight"
            style={{ color: "var(--feedback-warn-fg)" }}
          >
            Conflict: another writer recorded this case
          </p>
          <p
            className="text-[11px] leading-snug mt-1"
            style={{ color: "var(--fg-default)" }}
          >
            They recorded{" "}
            <StatusChip status={otherStatus} />
            {" "}
            <span style={{ color: "var(--fg-muted)" }}>
              {relativeTime(recordedAt)}
            </span>
            . Choose how to proceed:
          </p>
        </div>
        {/* Dismiss */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss conflict banner"
          className={cn(
            "shrink-0 opacity-50 hover:opacity-100 transition-opacity rounded",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-[color:var(--focus-ring)]",
            "text-[10px] font-medium px-1.5 py-0.5",
          )}
          style={{ color: "var(--feedback-warn-fg)" }}
        >
          dismiss
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {/* Overwrite */}
        <button
          type="button"
          onClick={() => void handleOverwrite()}
          disabled={phase !== "idle"}
          aria-label="Overwrite: record your intended result, replacing theirs"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-[12px] font-semibold border transition-all duration-100",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-[color:var(--focus-ring)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "active:scale-95",
          )}
          style={{
            background: "var(--feedback-warn-fg)",
            color: "var(--bg-app)",
            borderColor: "transparent",
          }}
        >
          {phase === "overwriting" ? (
            <div
              className="h-3.5 w-3.5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--bg-app)", borderTopColor: "transparent" }}
              aria-label="Overwriting…"
              role="status"
            />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {phase === "overwriting" ? "Overwriting…" : "Overwrite with mine"}
        </button>

        {/* Keep theirs */}
        <button
          type="button"
          onClick={handleKeepTheirs}
          disabled={phase !== "idle"}
          aria-label="Keep theirs: accept the other writer's result"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-[12px] font-semibold border transition-all duration-100",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-[color:var(--focus-ring)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "active:scale-95",
          )}
          style={{
            background: "transparent",
            color: "var(--feedback-warn-fg)",
            borderColor: "color-mix(in srgb, var(--feedback-warn-fg) 50%, transparent)",
          }}
        >
          {phase === "keeping" ? (
            <div
              className="h-3.5 w-3.5 rounded-full border-2 border-t-transparent animate-spin"
              style={{
                borderColor: "var(--feedback-warn-fg)",
                borderTopColor: "transparent",
              }}
              aria-label="Applying…"
              role="status"
            />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {phase === "keeping" ? "Applying…" : "Keep theirs"}
        </button>

        {/* Summary of what theirs was */}
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: "var(--fg-disabled)" }}
          aria-label={`Their result: revision ${reconcile.currentRevision}`}
        >
          rev {reconcile.currentRevision}
        </span>
      </div>
    </div>
  );
}
