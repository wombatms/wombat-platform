import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Lucide icon component or any ReactNode — defaults to Inbox */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Primary action button/link rendered below the description */
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState — inline callout shown when a list or detail has no data.
 *
 * Sits comfortably inside a table area or a full page. Uses a left
 * accent rule for visual anchoring without requiring a large footprint.
 * Both density modes feel correct since the component has fixed padding.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-start gap-3 px-5 py-6 max-w-md",
        className,
      )}
    >
      {/* Left-rule callout container */}
      <div
        className="flex flex-col gap-1.5 pl-4"
        style={{
          borderLeft: "3px solid var(--border-strong)",
        }}
      >
        {/* Icon row */}
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--fg-muted)" }}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
            style={{ background: "var(--bg-surface-2)" }}
          >
            {icon ?? <Inbox className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--fg-default)" }}
          >
            {title}
          </span>
        </div>

        {description && (
          <p
            className="text-xs leading-relaxed"
            style={{ color: "var(--fg-muted)" }}
          >
            {description}
          </p>
        )}
      </div>

      {action && <div>{action}</div>}
    </div>
  );
}
