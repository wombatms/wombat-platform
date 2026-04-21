import { useCallback, useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { RequireAuth } from "@/features/auth/guards";
import { Header } from "./Header";
import { LeftNav } from "./LeftNav";
import { useCommandPalette } from "@/features/search/CommandPaletteProvider";
import { GlobalShortcutsOverlay } from "@/lib/shortcuts/ShortcutsOverlay";
import { useTheme } from "@/lib/theme/useTheme";

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
 * Global shortcuts:
 *   t        — toggle theme (light/dark)
 *   g p      — go to projects
 *   g l      — go to library (current project)
 *   ?        — shortcuts overlay (via GlobalShortcutsOverlay)
 *   ⌘K       — command palette (via CommandPaletteProvider)
 */
export function AppShell() {
  const { open: openPalette } = useCommandPalette();
  const { mode, setMode, applied } = useTheme();
  const navigate = useNavigate();
  const { projectSlug } = useParams<{ projectSlug?: string }>();

  // Sequence shortcut state: track pending "g" for g+p / g+l
  const pendingG = useRef(false);
  const pendingGTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleThemeToggle = useCallback(() => {
    const next = applied === "light" ? "dark" : "light";
    setMode(next);
  }, [applied, setMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const isEditing =
        tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        tgt.isContentEditable;
      if (isEditing) return;

      // t — toggle theme
      if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
        handleThemeToggle();
        return;
      }

      // g p / g l sequence
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        pendingG.current = true;
        if (pendingGTimer.current) clearTimeout(pendingGTimer.current);
        pendingGTimer.current = setTimeout(() => {
          pendingG.current = false;
        }, 1000);
        return;
      }
      if (pendingG.current) {
        pendingG.current = false;
        if (pendingGTimer.current) clearTimeout(pendingGTimer.current);
        if (e.key === "p") {
          e.preventDefault();
          navigate("/projects");
          return;
        }
        if (e.key === "l") {
          e.preventDefault();
          if (projectSlug) navigate(`/p/${projectSlug}/library`);
          else navigate("/projects");
          return;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (pendingGTimer.current) clearTimeout(pendingGTimer.current);
    };
  }, [handleThemeToggle, navigate, projectSlug]);

  // Suppress the unused variable warning — mode is read by ThemePage
  void mode;

  return (
    <RequireAuth>
      <div
        className="flex h-screen flex-col overflow-hidden"
        style={{ background: "var(--bg-app)", color: "var(--fg-default)" }}
      >
        {/* Fixed header */}
        <Header onOpenCommandPalette={openPalette} />

        {/* Body: nav + main side-by-side — fills remaining height */}
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

        {/* Shortcuts help overlay — triggered by ? key */}
        <GlobalShortcutsOverlay />
      </div>
    </RequireAuth>
  );
}
