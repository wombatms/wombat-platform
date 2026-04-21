import { NavLink, Outlet } from "react-router-dom";
import { User, Key, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/settings/profile", label: "Profile", icon: User },
  { to: "/settings/tokens", label: "API Tokens", icon: Key },
  { to: "/settings/theme", label: "Theme", icon: Palette },
];

export function SettingsShell() {
  return (
    <div className="flex h-full">
      {/* Settings sub-nav */}
      <nav
        aria-label="Settings navigation"
        className="w-48 shrink-0 border-r overflow-y-auto"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        <div className="px-3 pt-5 pb-2">
          <p
            className="px-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Settings
          </p>
        </div>
        <ul className="flex flex-col gap-0.5 px-2 pb-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium",
                    "transition-colors duration-120 outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                    isActive
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-fg)]"
                      : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-surface-2)] hover:text-[color:var(--fg-default)]",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Settings content */}
      <main
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ background: "var(--bg-app)" }}
      >
        <Outlet />
      </main>
    </div>
  );
}
