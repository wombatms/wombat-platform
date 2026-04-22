/**
 * CaseRenderer — renders the snapshot body of a single RunCase.
 *
 * Displays:
 * - Snapshot badge: "Updated since snapshot — view current" pill when
 *   current_content_hash !== snapshot_content_hash (passed as props).
 * - Preconditions block (markdown if the snapshot contains them).
 * - StepTable from SP3.1 — renders the snapshot steps, NOT live content.
 *
 * This component never fetches. All data is passed down from the runner.
 *
 * The RunCase schema from the API doesn't include snapshot fields directly
 * (the API stores them in the snapshot envelope). We accept a typed
 * `CaseSnapshot` prop that the runner assembles from the API response.
 */

import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { StepTable, type Step } from "@/components/shared/StepTable";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaseSnapshot {
  /** wombat_id of the test case */
  wombat_id: string;
  title: string;
  priority?: string | null;
  preconditions?: string | null;
  /** Steps from the snapshot (at time the run was created) */
  steps: Step[];
  /** Hash of the snapshot content (from the run_case row) */
  snapshot_content_hash: string | null;
  /** Hash of the current live content (from the library record) */
  current_content_hash: string | null;
}

interface CaseRendererProps {
  projectSlug: string;
  snapshot: CaseSnapshot;
  /** 1-based position index of this case in the run */
  position: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// SnapshotDriftBadge
// ---------------------------------------------------------------------------

function SnapshotDriftBadge({
  projectSlug,
  wombatId,
}: {
  projectSlug: string;
  wombatId: string;
}) {
  return (
    <Link
      to={`/p/${projectSlug}/library/${wombatId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        "transition-opacity duration-120 hover:opacity-80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "focus-visible:ring-[color:var(--focus-ring)]",
      )}
      style={{
        background: "var(--feedback-warn-bg)",
        color: "var(--feedback-warn-fg)",
        border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 25%, transparent)",
      }}
      aria-label="This case has been updated since the run snapshot was taken. Click to view current content."
    >
      {/* Warning triangle */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5.5 1.5L10 9.5H1L5.5 1.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M5.5 5v2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="5.5" cy="8.3" r="0.4" fill="currentColor" />
      </svg>
      Updated since snapshot
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">— view current</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// CaseRenderer
// ---------------------------------------------------------------------------

export function CaseRenderer({
  projectSlug,
  snapshot,
  position,
  className,
}: CaseRendererProps) {
  const hasDrift =
    snapshot.snapshot_content_hash !== null &&
    snapshot.current_content_hash !== null &&
    snapshot.snapshot_content_hash !== snapshot.current_content_hash;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {/* Snapshot drift badge */}
      {hasDrift && (
        <div className="flex items-center gap-2">
          <SnapshotDriftBadge
            projectSlug={projectSlug}
            wombatId={snapshot.wombat_id}
          />
          <span
            className="text-[11px]"
            style={{ color: "var(--fg-disabled)" }}
          >
            You are testing the snapshot from when this run was created.
          </span>
        </div>
      )}

      {/* Case header: position + ID */}
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] font-mono"
          style={{ color: "var(--fg-disabled)" }}
          aria-label={`Case ${position}`}
        >
          #{position}
        </span>
        <span
          className="text-[11px] font-mono font-medium"
          style={{ color: "var(--fg-muted)" }}
        >
          {snapshot.wombat_id}
        </span>
      </div>

      {/* Preconditions */}
      {snapshot.preconditions && (
        <section aria-labelledby="preconditions-heading">
          <h2
            id="preconditions-heading"
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Preconditions
          </h2>
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-default)",
            }}
          >
            <MarkdownBody>{snapshot.preconditions}</MarkdownBody>
          </div>
        </section>
      )}

      {/* Steps */}
      <section aria-labelledby="steps-heading">
        <h2
          id="steps-heading"
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Steps
        </h2>
        <StepTable steps={snapshot.steps} />
      </section>
    </div>
  );
}
