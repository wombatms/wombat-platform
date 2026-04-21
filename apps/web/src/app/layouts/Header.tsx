import { Search } from "lucide-react";
import { ProjectSwitcher } from "@/features/projects/ProjectSwitcher";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { UserMenu } from "@/components/shared/UserMenu";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onOpenCommandPalette?: () => void;
}

/**
 * Fixed top header: logo · ProjectSwitcher · search trigger · ThemeToggle · UserMenu.
 * Keyboard: Tab navigates between interactive elements in DOM order.
 * ⌘K triggers the command palette (wired via onOpenCommandPalette prop,
 * consumed by AppShell which also holds global keydown listener).
 */
export function Header({ onOpenCommandPalette }: HeaderProps) {
  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 px-3"
      style={{
        background: "var(--bg-surface-1)",
        borderBottom: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-sm)",
      }}
      role="banner"
    >
      {/* Logo/mark */}
      <a
        href="/projects"
        className="flex items-center gap-1.5 shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
        aria-label="Wombat — home"
      >
        {/* Wombat logotype: a small geometric mark + wordmark */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          aria-hidden="true"
        >
          <rect width="22" height="22" rx="5" fill="var(--accent-primary)" />
          {/* Stylised W letterform */}
          <path
            d="M4 6l3 10 4-7 4 7 3-10"
            stroke="var(--fg-inverse)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className="text-sm font-semibold tracking-tight"
          style={{ color: "var(--fg-default)" }}
        >
          Wombat
        </span>
      </a>

      {/* Project switcher */}
      <div
        className="h-5 w-px mx-1 shrink-0"
        style={{ background: "var(--border-default)" }}
        aria-hidden="true"
      />
      <ProjectSwitcher />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Global search trigger */}
      <Button
        variant="ghost"
        size="sm"
        className="hidden sm:flex items-center gap-2 text-sm"
        style={{ color: "var(--fg-muted)" }}
        onClick={onOpenCommandPalette}
        aria-label="Open command palette (⌘K)"
        aria-keyshortcuts="Meta+k"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden md:inline">Search…</span>
        <kbd
          className="hidden md:inline-flex h-5 items-center rounded px-1 text-[10px] font-mono"
          style={{
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
            color: "var(--fg-muted)",
          }}
          aria-hidden="true"
        >
          ⌘K
        </kbd>
      </Button>

      {/* Theme toggle */}
      <ThemeToggle />

      {/* User menu */}
      <UserMenu />
    </header>
  );
}
