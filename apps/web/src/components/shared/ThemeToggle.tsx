import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Theme: ${mode}. Click to change.`}
          title="Toggle theme"
        >
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => setMode("light")}
          aria-current={mode === "light" ? "true" : undefined}
        >
          <Sun className="mr-2 h-4 w-4" aria-hidden="true" />
          Light
          {mode === "light" && (
            <span className="ml-auto text-[color:var(--accent-fg)]" aria-hidden="true">
              ✓
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setMode("dark")}
          aria-current={mode === "dark" ? "true" : undefined}
        >
          <Moon className="mr-2 h-4 w-4" aria-hidden="true" />
          Dark
          {mode === "dark" && (
            <span className="ml-auto text-[color:var(--accent-fg)]" aria-hidden="true">
              ✓
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setMode("system")}
          aria-current={mode === "system" ? "true" : undefined}
        >
          <Monitor className="mr-2 h-4 w-4" aria-hidden="true" />
          System
          {mode === "system" && (
            <span className="ml-auto text-[color:var(--accent-fg)]" aria-hidden="true">
              ✓
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

