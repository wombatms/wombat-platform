import type { MouseEvent } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface LinkedEntityRefData {
  /** Wombat ID, e.g. "SS-PAY-001" or "TC-PAY-012" */
  id: string;
  title: string;
  /** Optional short excerpt / first line of the description */
  snippet?: string;
  /** Route path to navigate to on click, e.g. /p/my-project/shared-steps/SS-PAY-001 */
  href?: string;
  /** Kind label shown in the popover header */
  kind?: string;
}

interface LinkedEntityRefProps {
  entity: LinkedEntityRefData;
  className?: string;
}

/**
 * LinkedEntityRef — a compact chip-link with a hover preview popover.
 *
 * - Monospace ID lozenge using code-bg + accent-fg.
 * - Hover opens a popover showing the entity's title + snippet.
 * - Keyboard-accessible: focus opens the popover.
 * - If `href` is present, clicking navigates (wraps in React Router Link).
 */
export function LinkedEntityRef({ entity, className }: LinkedEntityRefProps) {
  const [open, setOpen] = useState(false);

  const chipClasses = cn(
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
    "font-mono text-[11px] font-medium leading-none",
    "cursor-pointer outline-none select-none",
    "transition-colors duration-120",
    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
    className,
  );

  const chipStyle = {
    background: "var(--code-bg)",
    color: "var(--accent-fg)",
    border: "1px solid var(--border-default)",
  };

  const handleMouseEnter = (e: MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-primary)";
  };
  const handleMouseLeave = (e: MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
  };

  const chipContent = (
    <>
      {entity.id}
      {entity.href && (
        <ExternalLink className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
      )}
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {entity.href ? (
          <Link
            to={entity.href}
            aria-label={`${entity.kind ?? "Entity"} ${entity.id}: ${entity.title}`}
            className={chipClasses}
            style={chipStyle}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {chipContent}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={`${entity.kind ?? "Entity"} ${entity.id}: ${entity.title}`}
            className={chipClasses}
            style={chipStyle}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {chipContent}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        side="top"
        align="start"
        sideOffset={4}
      >
        <div className="flex flex-col gap-0">
          {/* Header: kind + id */}
          <div
            className="flex items-center gap-1.5 px-3 py-2"
            style={{
              borderBottom: "1px solid var(--border-default)",
              background: "var(--bg-surface-2)",
            }}
          >
            {entity.kind && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--fg-muted)" }}
              >
                {entity.kind}
              </span>
            )}
            <span
              className="font-mono text-[11px] font-medium"
              style={{ color: "var(--accent-fg)" }}
            >
              {entity.id}
            </span>
          </div>

          {/* Title + snippet */}
          <div className="flex flex-col gap-1 px-3 py-2.5">
            <p
              className="text-[13px] font-medium leading-snug"
              style={{ color: "var(--fg-default)" }}
            >
              {entity.title}
            </p>
            {entity.snippet && (
              <p
                className="text-[11px] leading-relaxed line-clamp-3"
                style={{ color: "var(--fg-muted)" }}
              >
                {entity.snippet}
              </p>
            )}
          </div>

          {/* Link footer */}
          {entity.href && (
            <div
              className="px-3 pb-2.5"
            >
              <Link
                to={entity.href}
                className="text-[11px] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                style={{ color: "var(--accent-fg)" }}
                onClick={() => setOpen(false)}
              >
                Open {entity.kind ?? "detail"} →
              </Link>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
