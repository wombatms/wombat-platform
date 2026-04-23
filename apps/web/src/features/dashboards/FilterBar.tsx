/**
 * FilterBar — project/plan dashboard filter controls (SP3.4 Task 50).
 *
 * Design decisions (frontend-design skill):
 * - Single compact row. No card chrome — the filter bar sits between the
 *   page header and the widget grid, visually subordinate to both.
 * - Window selector is a segmented control (button group) — four options
 *   (7d / 30d / 90d / all) require instant recognition, not a dropdown.
 * - Environment selector uses a native <select> wrapped in a styled shell
 *   for lowest bundle weight; the env list is short for most projects.
 * - Plan selector is project-scope only. Rendered as a styled <select>
 *   loaded from usePlansList; disabled while loading, empty option "All plans".
 * - All interactive elements are token-coloured. No hex. Focus rings via
 *   CSS `--focus-ring`.
 * - `aria-label` on the segmented control group for accessibility.
 * - "Clearing" env/plan_id writes undefined → setFilters removes the param.
 */

import { useParams } from "react-router-dom";
import { useEnvironments } from "@/features/runs/hooks/environments";
import { usePlansList } from "@/features/plans/hooks";
import type { DashboardFilters } from "./filters";

// ---------------------------------------------------------------------------
// Shared styled select shell
// ---------------------------------------------------------------------------

interface StyledSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function StyledSelect({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
}: StyledSelectProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-7 rounded-md px-2 text-xs appearance-none pr-6"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
          color: "var(--fg-default)",
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          // Inline chevron via background image
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%235d6471' stroke-width='1.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 6px center",
          paddingRight: "20px",
          minWidth: "120px",
        }}
      >
        {children}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Window segmented control
// ---------------------------------------------------------------------------

const WINDOWS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
] as const;

type WindowValue = (typeof WINDOWS)[number]["value"];

interface WindowSelectorProps {
  value: WindowValue;
  onChange: (v: WindowValue) => void;
}

function WindowSelector({ value, onChange }: WindowSelectorProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--fg-muted)" }}
      >
        Window
      </span>
      <div
        role="group"
        aria-label="Time window"
        className="flex overflow-hidden rounded-md"
        style={{ border: "1px solid var(--border-default)" }}
      >
        {WINDOWS.map((w, idx) => {
          const isActive = value === w.value;
          return (
            <button
              key={w.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(w.value)}
              className="h-7 px-2.5 text-xs font-medium transition-colors duration-100 outline-none"
              style={{
                background: isActive
                  ? "var(--accent-soft)"
                  : "var(--bg-surface-1)",
                color: isActive ? "var(--accent-fg)" : "var(--fg-muted)",
                borderLeft:
                  idx > 0 ? "1px solid var(--border-default)" : undefined,
                cursor: "pointer",
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow =
                  "inset 0 0 0 2px var(--focus-ring)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {w.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBar component
// ---------------------------------------------------------------------------

export interface FilterBarProps {
  scope: "project" | "plan";
  value: DashboardFilters;
  onChange: (partial: Partial<DashboardFilters>) => void;
}

export function FilterBar({ scope, value, onChange }: FilterBarProps) {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();

  const { data: environments, isLoading: envsLoading } = useEnvironments(projectSlug);
  const { data: plans, isLoading: plansLoading } = usePlansList(
    projectSlug,
    {},
  );

  return (
    <div
      className="flex flex-wrap items-end gap-4 px-5 py-3"
      style={{
        background: "var(--bg-surface-1)",
        border: "1px solid var(--border-default)",
        borderRadius: "8px",
      }}
    >
      {/* Window segmented control */}
      <WindowSelector
        value={(value.window ?? "30d") as WindowValue}
        onChange={(w) => onChange({ window: w })}
      />

      {/* Environment selector */}
      <StyledSelect
        id="filter-env"
        label="Environment"
        value={value.env_id ?? ""}
        onChange={(v) => onChange({ env_id: v || undefined })}
        disabled={envsLoading}
      >
        <option value="">All environments</option>
        {environments?.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
          </option>
        ))}
      </StyledSelect>

      {/* Plan selector — project scope only */}
      {scope === "project" && (
        <StyledSelect
          id="filter-plan"
          label="Plan"
          value={value.plan_id ?? ""}
          onChange={(v) => onChange({ plan_id: v || undefined })}
          disabled={plansLoading}
        >
          <option value="">All plans</option>
          {plans?.map((plan) => (
            <option key={plan.wombat_id} value={plan.wombat_id}>
              {plan.title}
            </option>
          ))}
        </StyledSelect>
      )}
    </div>
  );
}
