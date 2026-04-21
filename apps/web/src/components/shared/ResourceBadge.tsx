import type { ReactNode } from "react";
import {
  FileText,
  Share2,
  BookMarked,
  LayoutList,
  Layers,
  FileCode,
  AlertTriangle,
  Minus,
  ChevronDown,
  Zap,
  Hand,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type ResourceKind =
  | "testcase"
  | "shared_step"
  | "story"
  | "plan"
  | "suite"
  | "doc";

export type ResourcePriority = "high" | "med" | "low";
export type ResourceAutomation = "automated" | "manual";

export type ResourceBadgeVariant = "kind" | "priority" | "automation";

type KindBadgeProps = {
  variant: "kind";
  value: ResourceKind;
  className?: string;
};
type PriorityBadgeProps = {
  variant: "priority";
  value: ResourcePriority;
  className?: string;
};
type AutomationBadgeProps = {
  variant: "automation";
  value: ResourceAutomation;
  className?: string;
};

export type ResourceBadgeProps =
  | KindBadgeProps
  | PriorityBadgeProps
  | AutomationBadgeProps;

/* ------------------------------------------------------------------ */
/* Definitions                                                          */
/* ------------------------------------------------------------------ */

interface BadgeDef {
  label: string;
  icon: ReactNode;
  fgVar: string;
  bgVar: string;
  /** Shape: 'pill' = fully rounded, 'square' = small radius, 'angled' = left square right round */
  shape: "pill" | "square" | "angled";
}

const KIND_DEFS: Record<ResourceKind, BadgeDef> = {
  testcase: {
    label: "Testcase",
    icon: <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--accent-fg",
    bgVar: "--accent-soft",
    shape: "square",
  },
  shared_step: {
    label: "Shared Step",
    icon: <Share2 className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--feedback-info-fg",
    bgVar: "--feedback-info-bg",
    shape: "square",
  },
  story: {
    label: "Story",
    icon: <BookMarked className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--chart-cat-4",
    bgVar: "--accent-soft",
    shape: "square",
  },
  plan: {
    label: "Plan",
    icon: <LayoutList className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--feedback-success-fg",
    bgVar: "--feedback-success-bg",
    shape: "square",
  },
  suite: {
    label: "Suite",
    icon: <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--feedback-warn-fg",
    bgVar: "--feedback-warn-bg",
    shape: "square",
  },
  doc: {
    label: "Doc",
    icon: <FileCode className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--fg-muted",
    bgVar: "--bg-surface-2",
    shape: "square",
  },
};

const PRIORITY_DEFS: Record<ResourcePriority, BadgeDef> = {
  high: {
    label: "High",
    icon: <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--priority-high-fg",
    bgVar: "--priority-high-bg",
    shape: "angled", // sharp = urgency
  },
  med: {
    label: "Med",
    icon: <Minus className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--priority-med-fg",
    bgVar: "--priority-med-bg",
    shape: "square",
  },
  low: {
    label: "Low",
    icon: <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--priority-low-fg",
    bgVar: "--priority-low-bg",
    shape: "pill", // round = relaxed
  },
};

const AUTOMATION_DEFS: Record<ResourceAutomation, BadgeDef> = {
  automated: {
    label: "Automated",
    icon: <Zap className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--feedback-success-fg",
    bgVar: "--feedback-success-bg",
    shape: "pill",
  },
  manual: {
    label: "Manual",
    icon: <Hand className="h-3 w-3 shrink-0" aria-hidden="true" />,
    fgVar: "--fg-muted",
    bgVar: "--bg-surface-2",
    shape: "pill",
  },
};

function getBadgeDef(props: ResourceBadgeProps): BadgeDef {
  switch (props.variant) {
    case "kind":
      return KIND_DEFS[props.value];
    case "priority":
      return PRIORITY_DEFS[props.value];
    case "automation":
      return AUTOMATION_DEFS[props.value];
  }
}

function getBadgeAriaLabel(props: ResourceBadgeProps): string {
  switch (props.variant) {
    case "kind":
      return `Kind: ${KIND_DEFS[props.value].label}`;
    case "priority":
      return `Priority: ${PRIORITY_DEFS[props.value].label}`;
    case "automation":
      return `Automation: ${AUTOMATION_DEFS[props.value].label}`;
  }
}

/* ------------------------------------------------------------------ */
/* Shape → border-radius                                               */
/* ------------------------------------------------------------------ */

function shapeRadius(shape: BadgeDef["shape"]): string {
  switch (shape) {
    case "pill":
      return "9999px";
    case "square":
      return "4px";
    case "angled":
      return "2px 6px 6px 2px"; // sharp left, round right
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

/**
 * ResourceBadge — compact identifier pill for kind, priority, and automation.
 *
 * Non-color indicators: icon + shape + color, never color alone (spec §5.6).
 * Screen readers get an aria-label describing the variant + value.
 */
export function ResourceBadge(props: ResourceBadgeProps) {
  const def = getBadgeDef(props);
  const ariaLabel = getBadgeAriaLabel(props);

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wide leading-none",
        "whitespace-nowrap shrink-0",
        props.className,
      )}
      style={{
        borderRadius: shapeRadius(def.shape),
        background: `var(${def.bgVar})`,
        color: `var(${def.fgVar})`,
        border: `1px solid color-mix(in srgb, var(${def.fgVar}) 20%, transparent)`,
      }}
    >
      {def.icon}
      <span>{def.label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Convenience re-exports for common patterns                          */
/* ------------------------------------------------------------------ */

export function KindBadge({
  kind,
  className,
}: {
  kind: ResourceKind;
  className?: string;
}) {
  return <ResourceBadge variant="kind" value={kind} className={className} />;
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: ResourcePriority;
  className?: string;
}) {
  return (
    <ResourceBadge variant="priority" value={priority} className={className} />
  );
}

export function AutomationBadge({
  automation,
  className,
}: {
  automation: ResourceAutomation;
  className?: string;
}) {
  return (
    <ResourceBadge
      variant="automation"
      value={automation}
      className={className}
    />
  );
}
