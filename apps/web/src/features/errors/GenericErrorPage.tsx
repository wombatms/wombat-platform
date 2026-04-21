import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/* ------------------------------------------------------------------ */
/* GenericErrorPage — standalone render                                */
/* ------------------------------------------------------------------ */

interface GenericErrorPageProps {
  error?: Error | unknown;
  onRetry?: () => void;
}

export function GenericErrorPage({ error, onRetry }: GenericErrorPageProps) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected error occurred.";

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-6"
      style={{ background: "var(--bg-app)" }}
    >
      <div
        className="flex flex-col items-start gap-4 rounded-lg px-6 py-5 max-w-sm w-full"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
          borderLeft: "3px solid var(--feedback-error-fg)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle
            className="h-5 w-5 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--feedback-error-fg)" }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--feedback-error-fg)" }}
          >
            Error
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[15px] font-semibold" style={{ color: "var(--fg-default)" }}>
            Something went wrong
          </h1>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] transition-opacity duration-120"
          style={{ background: "var(--accent-primary)", color: "white" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.9"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RootErrorBoundary — class component wrapping GenericErrorPage       */
/* ------------------------------------------------------------------ */

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface BoundaryProps {
  children: ReactNode;
}

export class RootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <GenericErrorPage
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
