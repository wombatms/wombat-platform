import { useState } from "react";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

/** A single testcase step — direct action or shared-step reference */
export interface Step {
  /** Step index (1-based display number comes from array position) */
  step_order?: number;
  action?: string;
  test_data?: string;
  expected_result?: string;
  /**
   * If present, this step is a linked shared-step group.
   * The wombat_id of the referenced shared step.
   */
  shared_step_id?: string;
  /** Steps belonging to the linked shared step — populated if resolved */
  shared_step_steps?: Step[];
}

/** Resolved shared step reference, returned by the injected resolver */
export interface SharedStepRef {
  id: string;
  title: string;
  snippet?: string;
  href?: string;
  steps: Step[];
}

interface StepTableProps {
  steps: Step[];
  /**
   * Injected resolver — the component doesn't fetch; Phase 4 detail pages wire this.
   * Returns null/undefined when the shared step cannot be resolved.
   */
  resolveSharedStep?: (id: string) => SharedStepRef | null | undefined;
}

/* ------------------------------------------------------------------ */
/* StepTable                                                            */
/* ------------------------------------------------------------------ */

/**
 * StepTable — renders the ordered steps of a testcase.
 *
 * - Columns: #, Action, Data, Expected.
 * - Shared-step rows collapse into a disclosure group with a left rule
 *   in the info-fg color and a surface-2 background.
 * - The resolver is injected; this component never fetches.
 */
export function StepTable({ steps, resolveSharedStep }: StepTableProps) {
  if (steps.length === 0) {
    return (
      <p
        className="px-4 py-6 text-sm"
        style={{ color: "var(--fg-muted)" }}
      >
        No steps defined.
      </p>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-md text-sm"
      style={{ border: "1px solid var(--border-default)" }}
    >
      {/* Header */}
      <div
        className="grid gap-0"
        style={{
          gridTemplateColumns: "36px 1fr 1fr 1fr",
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {(["#", "Action", "Data", "Expected"] as const).map((col) => (
          <div
            key={col}
            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            {col}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div>
        {steps.map((step, idx) => {
          if (step.shared_step_id) {
            const resolved = resolveSharedStep?.(step.shared_step_id);
            return (
              <SharedStepRow
                key={`ss-${idx}`}
                index={idx + 1}
                sharedStepId={step.shared_step_id}
                resolved={resolved ?? null}
              />
            );
          }
          return (
            <DirectStepRow
              key={`step-${idx}`}
              index={idx + 1}
              step={step}
              isLast={idx === steps.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DirectStepRow                                                        */
/* ------------------------------------------------------------------ */

function DirectStepRow({
  index,
  step,
  isLast,
}: {
  index: number;
  step: Step;
  isLast: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-0",
        !isLast && "border-b",
      )}
      style={{
        gridTemplateColumns: "36px 1fr 1fr 1fr",
        borderBottomColor: "var(--border-subtle)",
      }}
    >
      {/* Step number */}
      <div
        className="flex items-start justify-center pt-2.5 pb-2 px-1 text-[11px] font-mono font-semibold shrink-0"
        style={{ color: "var(--fg-muted)" }}
      >
        {index}
      </div>

      {/* Action */}
      <StepCell value={step.action} />
      {/* Data */}
      <StepCell value={step.test_data} mono />
      {/* Expected */}
      <StepCell value={step.expected_result} />
    </div>
  );
}

function StepCell({ value, mono }: { value?: string; mono?: boolean }) {
  if (!value) {
    return (
      <div
        className="px-3 py-2.5 text-[12px]"
        style={{ color: "var(--fg-disabled)" }}
        aria-hidden="true"
      >
        —
      </div>
    );
  }
  return (
    <div
      className={cn(
        "px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words",
        mono && "font-mono text-[12px]",
      )}
      style={{
        color: mono ? "var(--code-fg)" : "var(--fg-default)",
        background: mono && value ? "var(--code-bg)" : undefined,
      }}
    >
      {value}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SharedStepRow                                                        */
/* ------------------------------------------------------------------ */

function SharedStepRow({
  index,
  sharedStepId,
  resolved,
}: {
  index: number;
  sharedStepId: string;
  resolved: SharedStepRef | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const title = resolved?.title ?? sharedStepId;
  const innerSteps = resolved?.steps ?? [];

  return (
    <div
      className="border-b last:border-0"
      style={{ borderBottomColor: "var(--border-subtle)" }}
    >
      {/* Disclosure header */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} shared step ${sharedStepId}`}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left",
          "transition-colors duration-120 outline-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]",
        )}
        style={{
          background: expanded ? "var(--bg-surface-2)" : "var(--bg-surface-1)",
          borderLeft: "3px solid var(--feedback-info-fg)",
        }}
        onMouseEnter={(e) => {
          if (!expanded)
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--bg-surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!expanded)
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--bg-surface-1)";
        }}
      >
        {/* Index */}
        <span
          className="w-5 shrink-0 text-[11px] font-mono font-semibold"
          style={{ color: "var(--fg-muted)" }}
        >
          {index}
        </span>

        {/* Shared-step icon */}
        <Share2
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
          style={{ color: "var(--feedback-info-fg)" }}
        />

        {/* Label */}
        <span className="flex-1 min-w-0 text-[13px] font-medium truncate"
          style={{ color: "var(--fg-default)" }}
        >
          <span
            className="font-mono text-[11px] mr-1.5"
            style={{ color: "var(--feedback-info-fg)" }}
          >
            {sharedStepId}
          </span>
          {title !== sharedStepId && (
            <span style={{ color: "var(--fg-muted)" }}>{title}</span>
          )}
        </span>

        {/* Step count badge */}
        {innerSteps.length > 0 && (
          <span
            className="shrink-0 text-[10px] font-medium"
            style={{ color: "var(--fg-muted)" }}
          >
            {innerSteps.length} step{innerSteps.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Caret */}
        {expanded ? (
          <ChevronDown
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
        )}
      </button>

      {/* Expanded inner steps */}
      {expanded && (
        <div
          className="pl-6"
          style={{
            background: "var(--bg-surface-2)",
            borderLeft: "3px solid var(--feedback-info-fg)",
          }}
        >
          {innerSteps.length === 0 ? (
            <p
              className="px-3 py-2 text-xs"
              style={{ color: "var(--fg-muted)" }}
            >
              {resolved ? "No steps in this shared step." : "Shared step not resolved."}
            </p>
          ) : (
            innerSteps.map((innerStep, innerIdx) => (
              <div
                key={innerIdx}
                className={cn(
                  "grid gap-0 border-t",
                )}
                style={{
                  gridTemplateColumns: "36px 1fr 1fr 1fr",
                  borderTopColor: "var(--border-subtle)",
                }}
              >
                {/* Sub-step number */}
                <div
                  className="flex items-start justify-center pt-2.5 pb-2 px-1 text-[11px] font-mono"
                  style={{ color: "var(--fg-disabled)" }}
                >
                  {index}.{innerIdx + 1}
                </div>
                <StepCell value={innerStep.action} />
                <StepCell value={innerStep.test_data} mono />
                <StepCell value={innerStep.expected_result} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
