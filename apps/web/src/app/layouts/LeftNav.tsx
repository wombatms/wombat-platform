import type { ComponentType, KeyboardEvent, SVGProps } from "react";
import { useCallback, useRef } from "react";
import { NavLink, useParams } from "react-router-dom";
import {
  BookOpen,
  Share2,
  BookMarked,
  Search,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  to: string;
  key: string;
  disabled?: boolean;
}

function useNavItems(projectSlug: string | undefined): {
  primary: NavItem[];
  secondary: NavItem[];
} {
  const base = projectSlug ? `/p/${projectSlug}` : "";
  const noProject = !projectSlug;

  const primary: NavItem[] = [
    { key: "library", label: "Test Library", icon: BookOpen, to: `${base}/library`, disabled: noProject },
    { key: "shared-steps", label: "Shared Steps", icon: Share2, to: `${base}/shared-steps`, disabled: noProject },
    { key: "stories", label: "Stories", icon: BookMarked, to: `${base}/stories`, disabled: noProject },
    { key: "search", label: "Search", icon: Search, to: `${base}/search`, disabled: noProject },
  ];

  const secondary: NavItem[] = [
    { key: "settings", label: "Settings", icon: Settings, to: "/settings/profile" },
  ];

  return { primary, secondary };
}

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title={`Select a project to access ${item.label}`}
        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium cursor-not-allowed select-none"
        style={{ color: "var(--fg-disabled)", opacity: 0.5 }}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
          "transition-colors duration-120 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          "focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--bg-surface-1)]",
          isActive
            ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-fg)]"
            : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-surface-2)] hover:text-[color:var(--fg-default)]",
        )
      }
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{item.label}</span>
          {isActive && <span className="sr-only">(current page)</span>}
        </>
      )}
    </NavLink>
  );
}

export function LeftNav() {
  const { projectSlug } = useParams<{ projectSlug?: string }>();
  const { primary, secondary } = useNavItems(projectSlug);
  const navRef = useRef<HTMLElement>(null);

  // Keyboard: up/down between nav links
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nav = navRef.current;
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll<HTMLElement>("a[href]"));
    const focused = document.activeElement as HTMLElement | null;
    const idx = focused ? links.indexOf(focused) : -1;
    e.preventDefault();
    if (e.key === "ArrowDown") {
      links[(idx + 1) % links.length]?.focus();
    } else {
      links[(idx - 1 + links.length) % links.length]?.focus();
    }
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <nav
      ref={navRef}
      aria-label="Main navigation"
      onKeyDown={handleKeyDown}
      className="flex h-full flex-col gap-1 px-2 py-3"
    >
      <ul className="flex flex-col gap-0.5">
        {primary.map((item) => (
          <li key={item.key}>
            <NavItemLink item={item} />
          </li>
        ))}
      </ul>

      <div
        className="my-2 h-px"
        style={{ background: "var(--border-default)" }}
        role="separator"
        aria-hidden="true"
      />

      <ul className="flex flex-col gap-0.5">
        {secondary.map((item) => (
          <li key={item.key}>
            <NavItemLink item={item} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
