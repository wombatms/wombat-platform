import type { ComponentType, CSSProperties } from "react";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useTheme } from "@/lib/theme/useTheme";
import type { ThemeMode } from "@/lib/theme/ThemeProvider";
import { cn } from "@/lib/utils";

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string; style?: CSSProperties; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Simulated surface colors for the mini preview */
  preview: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
  };
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    mode: "light",
    label: "Light",
    description: "Clean white surfaces",
    icon: Sun,
    preview: {
      bg: "#ffffff",
      surface: "#f4f4f5",
      text: "#18181b",
      muted: "#71717a",
      accent: "#2563eb",
    },
  },
  {
    mode: "dark",
    label: "Dark",
    description: "Easy on the eyes",
    icon: Moon,
    preview: {
      bg: "#09090b",
      surface: "#18181b",
      text: "#fafafa",
      muted: "#a1a1aa",
      accent: "#3b82f6",
    },
  },
  {
    mode: "system",
    label: "System",
    description: "Follows OS preference",
    icon: Monitor,
    preview: {
      bg: "linear-gradient(135deg, #ffffff 50%, #09090b 50%)",
      surface: "#f4f4f5",
      text: "#18181b",
      muted: "#71717a",
      accent: "#2563eb",
    },
  },
];

function MiniPreview({ option }: { option: ThemeOption }) {
  const isSystem = option.mode === "system";

  return (
    <div
      className="relative w-full rounded-md overflow-hidden"
      style={{
        height: 72,
        background: isSystem
          ? "linear-gradient(135deg, #ffffff 50%, #09090b 50%)"
          : option.preview.bg,
        border: "1px solid rgba(128,128,128,0.15)",
      }}
      aria-hidden="true"
    >
      {/* Mini chrome: header bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-1 px-2"
        style={{
          height: 16,
          background: isSystem
            ? "linear-gradient(135deg, #f4f4f5 50%, #18181b 50%)"
            : option.preview.surface,
          borderBottom: "1px solid rgba(128,128,128,0.12)",
        }}
      >
        <div className="w-2 h-1 rounded-sm" style={{ background: option.preview.accent }} />
        <div className="w-6 h-1 rounded-sm" style={{ background: option.preview.muted, opacity: 0.5 }} />
        <div className="w-4 h-1 rounded-sm" style={{ background: option.preview.muted, opacity: 0.3 }} />
      </div>

      {/* Content rows */}
      <div className="absolute top-5 left-2 right-2 flex flex-col gap-1.5">
        <div className="h-1.5 w-3/4 rounded-sm" style={{ background: option.preview.text, opacity: 0.7 }} />
        <div className="h-1 w-1/2 rounded-sm" style={{ background: option.preview.muted, opacity: 0.5 }} />
        <div className="flex gap-1 mt-0.5">
          <div className="h-2.5 w-8 rounded-sm" style={{ background: option.preview.accent, opacity: 0.85 }} />
          <div className="h-2.5 w-6 rounded-sm" style={{ background: option.preview.muted, opacity: 0.25 }} />
        </div>
      </div>
    </div>
  );
}

export function ThemePage() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Theme" subtitle="Choose your preferred color scheme" />

      <div className="p-6 max-w-lg flex flex-col gap-6">
        {/* Radio cards */}
        <fieldset className="flex flex-col gap-0 border-0 p-0 m-0">
          <legend className="sr-only">Color scheme</legend>
          <div className="flex flex-col gap-3">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = mode === option.mode;

              return (
                <label
                  key={option.mode}
                  className={cn(
                    "relative flex flex-col gap-3 rounded-lg p-4 cursor-pointer",
                    "transition-all duration-150 outline-none",
                    "focus-within:ring-2 focus-within:ring-[color:var(--focus-ring)]",
                  )}
                  style={{
                    background: isSelected ? "var(--accent-soft)" : "var(--bg-surface-1)",
                    border: isSelected
                      ? "2px solid var(--accent-primary)"
                      : "2px solid var(--border-default)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLLabelElement).style.borderColor = "var(--border-strong)";
                      (e.currentTarget as HTMLLabelElement).style.background = "var(--bg-surface-2)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLLabelElement).style.borderColor = "var(--border-default)";
                      (e.currentTarget as HTMLLabelElement).style.background = "var(--bg-surface-1)";
                    }
                  }}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.mode}
                    checked={isSelected}
                    onChange={() => setMode(option.mode)}
                    className="sr-only"
                  />

                  {/* Mini preview */}
                  <MiniPreview option={option} />

                  {/* Label row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                        style={{ color: isSelected ? "var(--accent-fg)" : "var(--fg-muted)" }}
                      />
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="text-[13px] font-semibold"
                          style={{ color: isSelected ? "var(--accent-fg)" : "var(--fg-default)" }}
                        >
                          {option.label}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {option.description}
                        </span>
                      </div>
                    </div>

                    {/* Selected indicator */}
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-150"
                      style={
                        isSelected
                          ? { background: "var(--accent-primary)", color: "white" }
                          : { background: "var(--bg-surface-2)", border: "2px solid var(--border-default)" }
                      }
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* System note */}
        <p
          className="text-[12px] leading-relaxed rounded-md px-4 py-3"
          style={{
            background: "var(--bg-surface-1)",
            border: "1px solid var(--border-default)",
            color: "var(--fg-muted)",
          }}
        >
          <strong style={{ color: "var(--fg-default)" }}>System</strong> automatically switches
          between Light and Dark based on your operating system&apos;s color scheme preference
          (set in System Preferences or Display Settings).
        </p>
      </div>
    </div>
  );
}
