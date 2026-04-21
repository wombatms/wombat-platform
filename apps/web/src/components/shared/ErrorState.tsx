import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/lib/api/errors";

interface ErrorStateProps {
  /** ApiError instance or a plain Error */
  error: ApiError | Error | unknown;
  /** Called when the user clicks Retry — should re-run the query */
  onRetry?: () => void;
  title?: string;
  className?: string;
}

function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e &&
    e instanceof Error
  );
}

/**
 * ErrorState — inline error callout that renders ApiError details in a
 * collapsible section, with a Retry button that re-runs the owning Query.
 *
 * Left rule uses the feedback-error token so the severity is visible
 * without relying on color alone (the AlertCircle icon also signals error).
 */
export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
  className,
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected error occurred.";

  const code = isApiError(error) ? error.code : undefined;
  const hint = isApiError(error) ? error.hint : undefined;
  const hasDetails = Boolean(code ?? hint);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex flex-col items-start gap-3 px-5 py-6 max-w-lg",
        className,
      )}
    >
      {/* Left-rule callout */}
      <div
        className="flex flex-col gap-2 pl-4 w-full"
        style={{
          borderLeft: "3px solid var(--feedback-error-fg)",
        }}
      >
        {/* Icon + title row */}
        <div className="flex items-center gap-2">
          <AlertCircle
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--feedback-error-fg)" }}
          />
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--fg-default)" }}
          >
            {title}
          </span>
        </div>

        {/* Error message */}
        <p
          className="text-xs leading-relaxed"
          style={{ color: "var(--fg-muted)" }}
        >
          {message}
        </p>

        {/* Collapsible details (code + hint) */}
        {hasDetails && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium",
                "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                "rounded-sm",
              )}
              style={{ color: "var(--fg-muted)" }}
            >
              {detailsOpen ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
              {detailsOpen ? "Hide" : "Show"} details
            </button>

            {detailsOpen && (
              <dl
                className="rounded-md px-3 py-2 text-[11px] font-mono flex flex-col gap-1"
                style={{
                  background: "var(--code-bg)",
                  color: "var(--code-fg)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {code && (
                  <div className="flex gap-2">
                    <dt style={{ color: "var(--fg-muted)" }}>code</dt>
                    <dd
                      className="font-semibold"
                      style={{ color: "var(--feedback-error-fg)" }}
                    >
                      {code}
                    </dd>
                  </div>
                )}
                {hint && (
                  <div className="flex gap-2">
                    <dt style={{ color: "var(--fg-muted)" }}>hint</dt>
                    <dd style={{ color: "var(--code-fg)" }}>{hint}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}
      </div>

      {/* Retry button */}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
