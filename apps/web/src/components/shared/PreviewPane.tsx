import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PreviewPaneProps {
  /** Content to render in the pane — provided by the parent list page */
  children: ReactNode;
  /** Placeholder shown when nothing is selected */
  placeholder?: string;
  className?: string;
}

/**
 * PreviewPane — 320px right-hand panel for list page entity previews.
 *
 * The parent controls open/close via conditional rendering.
 * Children are the entity-specific content; the pane provides only
 * the container, border, and scrolling.
 */
export function PreviewPane({ children, placeholder, className }: PreviewPaneProps) {
  return (
    <aside
      aria-label="Entity preview"
      className={cn(
        "w-80 shrink-0 overflow-y-auto border-l",
        className,
      )}
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      {children ?? (
        <div
          className="flex h-full items-center justify-center text-[12px]"
          style={{ color: "var(--fg-disabled)" }}
        >
          {placeholder ?? "Select a row to preview"}
        </div>
      )}
    </aside>
  );
}
