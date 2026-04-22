import { Zap } from "lucide-react";
import { useParams } from "react-router-dom";

/**
 * RunExecutePage — full-screen runner entry point (Focus Mode default, ?view=grid).
 *
 * This page renders WITHOUT the AppShell chrome (no sidebar, no header).
 * It is loaded via React.lazy to keep it out of the main bundle.
 *
 * SP3.3 stub. Full implementation in Tasks 46–51.
 *
 * IMPORTANT: This file MUST use a default export. React.lazy only works
 * with default exports.
 */
export default function RunExecutePage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-center gap-6"
      style={{ background: "var(--bg-app)", color: "var(--fg-default)" }}
    >
      {/* Minimal brand mark — runner has no sidebar */}
      <div className="flex items-center gap-2">
        <Zap
          className="h-6 w-6"
          aria-hidden="true"
          style={{ color: "var(--accent-primary)" }}
        />
        <span
          className="text-sm font-semibold tracking-wide uppercase"
          style={{ color: "var(--fg-muted)", letterSpacing: "0.1em" }}
        >
          Wombat Runner
        </span>
      </div>

      <div
        className="flex flex-col items-center gap-4 rounded-xl px-10 py-10 text-center max-w-sm"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px dashed var(--border-strong)",
        }}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase"
          style={{
            background: "var(--feedback-warn-bg)",
            color: "var(--feedback-warn-fg)",
          }}
        >
          Under construction
        </span>
        <Zap
          className="h-8 w-8"
          aria-hidden="true"
          style={{ color: "var(--fg-disabled)" }}
        />
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          Runner for run {id ?? "…"} coming in Tasks 46–51
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Full-screen Focus Mode (default) and Grid Mode (?view=grid) with
          keyboard-driven result recording, evidence attachments, and real-time
          conflict reconciliation.
        </p>
      </div>

      <p className="text-xs" style={{ color: "var(--fg-disabled)" }}>
        This page is code-split — it loads in a separate bundle chunk.
      </p>
    </div>
  );
}
