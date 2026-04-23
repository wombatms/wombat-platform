/**
 * DashboardPage — shared grid layout for project-home and plan-home (SP3.4 Task 50).
 *
 * Design decisions (frontend-design skill):
 * - 12-column CSS grid, `auto-rows-[110px]`, gap-4. Slot sizing per spec §5.4:
 *     PassFailTrend   col-span 6, row-span 2
 *     RecentRuns      col-span 6, row-span 2
 *     TopFailingCases col-span 6, row-span 3
 *     ReviewBacklog   col-span 6, row-span 1  (project scope only)
 *     ReleaseReadiness col-span 12, row-span 1 (project) / row-span 2 (plan)
 *
 * - Tailwind v4 JIT cannot scan dynamically-constructed class strings.
 *   Grid placement uses inline `style` props (`gridColumn: "span N"`,
 *   `gridRow: "span N"`) — this is the only safe approach with Tailwind v4 beta.
 *   Static Tailwind utility classes are still used for all other visual properties.
 *
 * - The `<Widget>` inner helper looks up WIDGETS[slug] and renders the
 *   component's `<Component>` with `scope`, `filters`. Unknown slugs fall back to
 *   a friendly "unknown widget" card (defensive — the registry is typed but the
 *   map lookup returns undefined at runtime for misspelled slugs).
 *
 * - `review_backlog` is omitted on plan scope per spec §8. Handled by a
 *   conditional in the grid layout, not inside the widget component itself.
 *
 * - FilterBar + useFiltersFromUrl: filter state lives in the URL so links are
 *   shareable and Back/Forward work. DashboardPage is purely a layout compositor;
 *   it owns no local state beyond what comes from the URL.
 */

import type { ReactNode } from "react";
import type { Scope, Filters } from "./hooks";
import { WIDGETS, type WidgetSlug } from "./widgets/index";
import { FilterBar } from "./FilterBar";
import { useFiltersFromUrl } from "./filters";

// ---------------------------------------------------------------------------
// Slot — grid cell wrapper with inline span styles
// ---------------------------------------------------------------------------

interface SlotProps {
  col: number;
  row: number;
  children: ReactNode;
}

/**
 * Slot wraps a single grid cell. Uses inline style for col/row spans because
 * Tailwind v4 JIT cannot pick up dynamically interpolated class names.
 * All other tokens come from CSS variables.
 */
function Slot({ col, row, children }: SlotProps) {
  return (
    <div
      style={{
        gridColumn: `span ${col}`,
        gridRow: `span ${row}`,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget — looks up the registry entry and renders it
// ---------------------------------------------------------------------------

interface WidgetProps {
  slug: string;
  scope: Scope;
  filters: Filters;
}

function Widget({ slug, scope, filters }: WidgetProps) {
  const entry = WIDGETS[slug as WidgetSlug];

  if (!entry) {
    // Defensive fallback — should never happen when called from within DashboardPage
    return (
      <div
        className="flex h-full items-center justify-center rounded-lg text-xs"
        style={{
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface-1)",
          color: "var(--fg-muted)",
        }}
        role="status"
        aria-label={`Unknown widget: ${slug}`}
      >
        Widget &ldquo;{slug}&rdquo; not found
      </div>
    );
  }

  const { Component } = entry;
  return <Component scope={scope} filters={filters} />;
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

export interface DashboardPageProps {
  /** "project" for project-home; "plan" for plan-home. */
  scope: "project" | "plan";
  /**
   * The scope_id:
   * - When scope="project" this is the project's UUID (from project.id).
   * - When scope="plan" this is the plan's wombat_id.
   */
  scopeId: string;
}

export function DashboardPage({ scope, scopeId }: DashboardPageProps) {
  const { filters, setFilters } = useFiltersFromUrl();

  // Build the discriminated Scope union expected by useWidget / widget components
  const widgetScope: Scope =
    scope === "project"
      ? { kind: "project", projectId: scopeId }
      : { kind: "plan", planWombatId: scopeId };

  // ReleaseReadiness row-span: 1 on project (shorter widget, wide), 2 on plan
  const releaseReadinessRows = scope === "plan" ? 2 : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <FilterBar
        scope={scope}
        value={filters}
        onChange={setFilters}
      />

      {/*
        12-column grid. auto-rows-[110px] makes each row 110px tall.
        Widgets span multiple rows to reach their design heights:
          - 2-row slot = 220px + gap
          - 3-row slot = 330px + gaps
        Tailwind v4: col/row span via inline style (see Slot comment).
      */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gridAutoRows: "110px",
        }}
      >
        {/* Row 1–2, cols 1–6: PassFailTrend */}
        <Slot col={6} row={2}>
          <Widget slug="passfail_trend" scope={widgetScope} filters={filters} />
        </Slot>

        {/* Row 1–2, cols 7–12: RecentRuns */}
        <Slot col={6} row={2}>
          <Widget slug="recent_runs" scope={widgetScope} filters={filters} />
        </Slot>

        {/* Row 3–5, cols 1–6: TopFailingCases */}
        <Slot col={6} row={3}>
          <Widget slug="top_failing_cases" scope={widgetScope} filters={filters} />
        </Slot>

        {/* Row 3, cols 7–12: ReviewBacklog (project only) */}
        {scope === "project" && (
          <Slot col={6} row={1}>
            <Widget slug="review_backlog" scope={widgetScope} filters={filters} />
          </Slot>
        )}

        {/* Final row: ReleaseReadiness — full width */}
        <Slot col={12} row={releaseReadinessRows}>
          <Widget slug="release_readiness" scope={widgetScope} filters={filters} />
        </Slot>
      </div>
    </div>
  );
}
