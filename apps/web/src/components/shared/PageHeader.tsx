import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Density = "comfortable" | "compact";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-aligned action buttons / controls */
  actions?: ReactNode;
  /** Number shown in a count pill next to the title */
  count?: number;
  /** Current density — renders the toggle if provided */
  density?: Density;
  onDensityChange?: (next: Density) => void;
  className?: string;
}

/**
 * PageHeader — sticky masthead for list and detail pages.
 *
 * Layout:
 *   ┌─ title · count pill ──────────────── density · actions ─┐
 *   │  subtitle (optional)                                     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * All colors via tokens; no hex.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  count,
  density,
  onDensityChange,
  className,
}: PageHeaderProps) {
  const hasDensityToggle = density !== undefined && onDensityChange !== undefined;

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex flex-col gap-0.5 px-5 py-3",
        className,
      )}
      style={{
        background: "var(--bg-app)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <div className="flex min-h-[32px] items-center gap-3">
        {/* Title + count */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1
            className="truncate text-[15px] font-semibold tracking-tight leading-tight"
            style={{ color: "var(--fg-default)" }}
          >
            {title}
          </h1>
          {count !== undefined && (
            <span
              aria-label={`${count} items`}
              className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums shrink-0"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent-fg)",
              }}
            >
              {count.toLocaleString()}
            </span>
          )}
        </div>

        {/* Right side: density toggle + actions */}
        <div className="flex shrink-0 items-center gap-2">
          {hasDensityToggle && (
            <DensityToggle value={density} onChange={onDensityChange} />
          )}
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      </div>

      {subtitle && (
        <p
          className="text-xs leading-snug"
          style={{ color: "var(--fg-muted)" }}
        >
          {subtitle}
        </p>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Density toggle                                                        */
/* ------------------------------------------------------------------ */

interface DensityToggleProps {
  value: Density;
  onChange: (next: Density) => void;
}

function DensityToggle({ value, onChange }: DensityToggleProps) {
  return (
    <div
      role="group"
      aria-label="Row density"
      className="flex items-center rounded-md overflow-hidden"
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface-2)",
      }}
    >
      <DensityButton
        label="Comfortable rows"
        active={value === "comfortable"}
        onClick={() => onChange("comfortable")}
        icon={<ComfortableIcon />}
      />
      <div
        className="w-px self-stretch"
        style={{ background: "var(--border-default)" }}
        aria-hidden="true"
      />
      <DensityButton
        label="Compact rows"
        active={value === "compact"}
        onClick={() => onChange("compact")}
        icon={<CompactIcon />}
      />
    </div>
  );
}

function DensityButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center transition-colors duration-120",
        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        "focus-visible:ring-inset",
      )}
      style={
        active
          ? { background: "var(--bg-surface-3)", color: "var(--accent-fg)" }
          : { background: "transparent", color: "var(--fg-muted)" }
      }
    >
      {icon}
    </button>
  );
}

/** Four equal-height bars */
function ComfortableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="2"  width="10" height="2" rx="0.5" fill="currentColor" />
      <rect x="2" y="6"  width="10" height="2" rx="0.5" fill="currentColor" />
      <rect x="2" y="10" width="10" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

/** Six tighter bars */
function CompactIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="1.5" width="10" height="1.5" rx="0.4" fill="currentColor" />
      <rect x="2" y="4.5" width="10" height="1.5" rx="0.4" fill="currentColor" />
      <rect x="2" y="7.5" width="10" height="1.5" rx="0.4" fill="currentColor" />
      <rect x="2" y="10.5" width="10" height="1.5" rx="0.4" fill="currentColor" />
    </svg>
  );
}
