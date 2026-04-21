import { Link } from "react-router-dom";
import { ShieldOff } from "lucide-react";

export function ForbiddenPage() {
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
          borderLeft: "3px solid var(--feedback-warn-fg)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <ShieldOff
            className="h-5 w-5 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--feedback-warn-fg)" }}
          />
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--feedback-warn-fg)" }}
          >
            403
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[15px] font-semibold" style={{ color: "var(--fg-default)" }}>
            Access denied
          </h1>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            You don&apos;t have permission to view this resource.
          </p>
        </div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] transition-colors duration-120"
          style={{
            background: "var(--accent-primary)",
            color: "white",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.opacity = "0.9";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
          }}
        >
          Go to projects
        </Link>
      </div>
    </div>
  );
}
