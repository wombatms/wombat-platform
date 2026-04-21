import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { RequireAuth } from "@/features/auth/guards";
import { Header } from "./Header";
import { LeftNav } from "./LeftNav";

/**
 * Accessible overlay for the command palette placeholder.
 * Uses a real button for the backdrop dismiss so a11y rules are satisfied.
 * Phase 4 Task 43 replaces this stub with the full cmdk CommandPalette.
 */
function PaletteOverlay({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      aria-hidden="false"
    >
      {/* Backdrop dismiss */}
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 w-full h-full cursor-default"
        onClick={onClose}
        tabIndex={-1}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-lg p-4 text-sm outline-none"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <p style={{ color: "var(--fg-muted)" }}>
          Command palette — wired in Task 43. Press{" "}
          <kbd
            className="rounded px-1 py-0.5 text-[11px] font-mono"
            style={{
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-default)",
            }}
          >
            Esc
          </kbd>{" "}
          to close.
        </p>
      </div>
    </div>
  );
}

/**
 * AppShell — authenticated three-region grid.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │          Header (48px)           │
 *   ├──────────┬───────────────────────┤
 *   │ LeftNav  │  Main (scrollable)    │
 *   │ (220px)  │                       │
 *   └──────────┴───────────────────────┘
 *
 * - Unauthenticated users are redirected to /login by RequireAuth.
 * - ⌘K opens the command palette (placeholder until Task 43).
 * - Reduced-motion respected; no decorative animation.
 */
export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <RequireAuth>
      {/* Outer wrapper fills viewport */}
      <div
        className="flex flex-col min-h-screen"
        style={{ background: "var(--bg-app)", color: "var(--fg-default)" }}
      >
        {/* Fixed header */}
        <Header onOpenCommandPalette={openPalette} />

        {/* Body: nav + main side-by-side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left nav — fixed width, scrollable on overflow */}
          <aside
            className="w-[220px] shrink-0 overflow-y-auto"
            style={{
              background: "var(--bg-surface-1)",
              borderRight: "1px solid var(--border-default)",
            }}
          >
            <LeftNav />
          </aside>

          {/* Main content area */}
          <main
            id="main-content"
            className="flex-1 min-w-0 overflow-y-auto"
            style={{ background: "var(--bg-app)" }}
            tabIndex={-1}
          >
            <Outlet />
          </main>
        </div>

        {/* Command palette placeholder — Task 43 wires cmdk here */}
        {paletteOpen && (
          <PaletteOverlay onClose={() => setPaletteOpen(false)} />
        )}
      </div>
    </RequireAuth>
  );
}
