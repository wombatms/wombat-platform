/**
 * WidgetFrame — shared wrapper for all dashboard widget components (SP3.4 Task 49).
 *
 * Design decisions (frontend-design skill):
 * - Skeleton loading: animated-pulse rows in the body area, fixed-height
 *   title placeholder in the header — never a full spinner.
 * - Error state: left 3px error-rule, AlertCircle icon, Retry button;
 *   mirrors the shared ErrorState aesthetic.
 * - Empty state: muted, centered, context-appropriate prompt via `emptyMessage`.
 * - Base card: subtle border + shadow-sm, bg-surface-1, rounded-lg.
 *   The title strip is separated from the body with a thin border-subtle
 *   rule — no heavy background differentiation.
 * - The frame intentionally does NOT set a fixed height. The dashboard
 *   layout grid (12-col, auto-rows-[110px]) controls sizing via grid-area.
 */

import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WidgetFrameProps {
  title: string;
  children?: ReactNode;
  isLoading?: boolean;
  error?: Error | unknown;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sub-states
// ---------------------------------------------------------------------------

function SkeletonCard({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col h-full rounded-lg overflow-hidden"
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface-1)",
        boxShadow: "var(--shadow-sm)",
      }}
      aria-busy="true"
      aria-label={`Loading ${title}`}
    >
      {/* Header area */}
      <div
        className="flex items-center px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Skeleton className="h-4 w-32" />
      </div>
      {/* Body skeleton */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

function ErrorCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: Error | unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected error occurred.";

  return (
    <div
      className="flex flex-col h-full rounded-lg overflow-hidden"
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface-1)",
        boxShadow: "var(--shadow-sm)",
      }}
      role="alert"
    >
      <div
        className="flex items-center px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-4 flex-1">
        <div
          className="flex flex-col gap-2 pl-3"
          style={{ borderLeft: "3px solid var(--feedback-error-fg)" }}
        >
          <div className="flex items-center gap-1.5">
            <AlertCircle
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--feedback-error-fg)" }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium" style={{ color: "var(--fg-default)" }}>
              Failed to load
            </span>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {message}
          </p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry} className="gap-1.5 self-start mt-1">
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyCard({
  title,
  emptyMessage,
}: {
  title: string;
  emptyMessage?: string;
}) {
  return (
    <div
      className="flex flex-col h-full rounded-lg overflow-hidden"
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface-1)",
        boxShadow: "var(--shadow-sm)",
      }}
      role="status"
      aria-label={`${title} — no data`}
    >
      <div
        className="flex items-center px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
          {title}
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <p
          className="text-xs text-center max-w-[200px] leading-relaxed"
          style={{ color: "var(--fg-disabled)" }}
        >
          {emptyMessage ?? "No data available"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WidgetFrame
// ---------------------------------------------------------------------------

export function WidgetFrame({
  title,
  children,
  isLoading,
  error,
  empty,
  emptyMessage,
  onRetry,
  className,
}: WidgetFrameProps) {
  if (isLoading) return <SkeletonCard title={title} />;
  if (error) return <ErrorCard title={title} error={error} onRetry={onRetry} />;
  if (empty) return <EmptyCard title={title} emptyMessage={emptyMessage} />;

  return (
    <div
      className={cn("flex flex-col h-full rounded-lg overflow-hidden", className)}
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface-1)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Title strip */}
      <div
        className="flex items-center shrink-0 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h3
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          {title}
        </h3>
      </div>
      {/* Body */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
