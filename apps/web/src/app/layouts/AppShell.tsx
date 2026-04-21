import { Outlet } from "react-router-dom";

/**
 * AppShell: the authenticated 3-region grid (header / nav / main).
 * Styling and navigation population arrive in Task 23. For now it renders
 * a minimal header + main so nested routes can mount.
 */
export function AppShell() {
  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-[color:var(--bg-app)] text-[color:var(--fg-default)]">
      <header className="flex h-14 items-center gap-4 border-b border-[color:var(--border-default)] bg-[color:var(--bg-surface-1)] px-4">
        <span className="text-sm font-semibold tracking-tight">Wombat</span>
      </header>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
