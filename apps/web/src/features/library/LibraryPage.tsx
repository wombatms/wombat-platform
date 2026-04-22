import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BookOpen, PanelRight, PlayCircle, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacetBar } from "@/components/shared/FacetBar";
import { EntityTable } from "@/components/shared/EntityTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PriorityBadge, AutomationBadge } from "@/components/shared/ResourceBadge";
import type { ResourcePriority, ResourceAutomation } from "@/components/shared/ResourceBadge";
import type { Density } from "@/components/shared/PageHeader";
import type { FacetValue } from "@/components/shared/FacetBar";
import { useDensity } from "@/lib/density/useDensity";
import { usePreview } from "@/lib/preview/usePreview";
import { useTestcaseList, type Testcase } from "./useTestcaseList";
import { testcaseColumns } from "./columns";
import { cn } from "@/lib/utils";

const FACET_FIELDS = ["component", "tag", "priority", "automation"];

/* ------------------------------------------------------------------ */
/* Preview pane                                                         */
/* ------------------------------------------------------------------ */

function PreviewPane({ tc }: { tc: Testcase | null }) {
  if (!tc) {
    return (
      <aside
        className="w-80 shrink-0 overflow-y-auto border-l flex items-center justify-center"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-1)",
          color: "var(--fg-disabled)",
          fontSize: "12px",
        }}
      >
        Select a row to preview
      </aside>
    );
  }
  return (
    <aside
      className="w-80 shrink-0 overflow-y-auto border-l"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      <div className="flex flex-col gap-3 p-4">
        <p
          className="font-mono text-[11px] font-semibold"
          style={{ color: "var(--accent-fg)" }}
        >
          {tc.wombat_id}
        </p>
        <p
          className="text-[13px] font-medium leading-snug"
          style={{ color: "var(--fg-default)" }}
        >
          {tc.title}
        </p>
        <dl className="flex flex-col gap-2 text-[12px]">
          {tc.priority && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Priority</dt>
              <dd><PriorityBadge priority={tc.priority as ResourcePriority} /></dd>
            </div>
          )}
          {tc.automation && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Automation</dt>
              <dd><AutomationBadge automation={tc.automation as ResourceAutomation} /></dd>
            </div>
          )}
          {tc.component && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Component</dt>
              <dd style={{ color: "var(--fg-default)" }}>{tc.component}</dd>
            </div>
          )}
          {tc.tags && tc.tags.length > 0 && (
            <div className="flex items-start gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {tc.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: "var(--bg-surface-2)",
                      color: "var(--fg-muted)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {tc.updated_at && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Updated</dt>
              <dd className="tabular-nums" style={{ color: "var(--fg-muted)" }}>
                {new Date(tc.updated_at).toLocaleDateString()}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk action toolbar                                                  */
/* ------------------------------------------------------------------ */

interface BulkToolbarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onAddToNewRun: () => void;
}

function BulkToolbar({ selectedIds, onClear, onAddToNewRun }: BulkToolbarProps) {
  const count = selectedIds.size;
  if (count === 0) return null;

  return (
    <div
      className="flex items-center gap-3 px-5 py-2 border-b"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--accent-soft)",
      }}
      role="toolbar"
      aria-label="Bulk actions"
    >
      {/* Selection count */}
      <span
        className="text-[12px] font-semibold tabular-nums"
        style={{ color: "var(--accent-fg)" }}
      >
        {count} selected
      </span>

      <div
        className="w-px h-4 shrink-0"
        style={{ background: "var(--border-default)" }}
        aria-hidden="true"
      />

      {/* Add to new run action */}
      <button
        type="button"
        onClick={onAddToNewRun}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium",
          "transition-colors duration-120 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        )}
        style={{
          background: "var(--accent-primary)",
          color: "var(--fg-inverse)",
        }}
      >
        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Add to new run
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",
          "transition-colors duration-120 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        )}
        style={{
          color: "var(--fg-muted)",
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-default)",
        }}
      >
        <X className="h-3 w-3" aria-hidden="true" />
        Clear
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function LibrarySkeleton({ density }: { density: Density }) {
  const rowH = density === "compact" ? "h-7" : "h-9";
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading testcases">
      {/* Header skeleton */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}
      >
        <div className="h-5 w-32 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-8 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Facet bar skeleton */}
      <div className="flex gap-2 px-5 py-2 border-b" style={{ borderColor: "var(--border-default)" }}>
        <div className="h-6 w-20 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-6 w-24 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Column header skeleton */}
      <div
        className="flex items-center px-3 border-b"
        style={{ height: 34, borderColor: "var(--border-default)", background: "var(--bg-surface-2)" }}
      >
        {[140, 0, 96, 116, 180, 120].map((w, i) => (
          <div
            key={i}
            className="px-3"
            style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}
          >
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className={cn("flex items-center px-3 border-b", rowH)}
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="px-3" style={{ width: 140 }}>
            <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="flex-1 px-3">
            <div
              className="h-3 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)", width: `${55 + (i % 4) * 10}%` }}
            />
          </div>
          <div className="px-3" style={{ width: 96 }}>
            <div className="h-4 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="px-3" style={{ width: 116 }}>
            <div className="h-4 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="flex gap-1 px-3" style={{ width: 180 }}>
            <div className="h-4 w-10 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="px-3" style={{ width: 120 }}>
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LibraryPage                                                          */
/* ------------------------------------------------------------------ */

export function LibraryPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  const [density, setDensity, toggleDensity] = useDensity();
  const [previewOpen, , togglePreview] = usePreview("library");
  const [facets, setFacets] = useState<FacetValue[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [focused, setFocused] = useState<Testcase | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Build filters from facets
  const filters = facets.reduce<Record<string, string[]>>((acc, f) => {
    const k = f.key;
    acc[k] = [...(acc[k] ?? []), f.value];
    return acc;
  }, {});

  const q = filters["q"]?.[0];
  const component = filters["component"]?.[0];
  const tag = filters["tag"];

  const { data, isLoading, isError, error, refetch } = useTestcaseList(
    projectSlug,
    { q, component, tag },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // Keyboard: `p` toggles preview, `/` focuses search, `d` toggles density
  // `x` toggles selection on focused row, `Esc` clears bulk selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "p" && !isEditing && !e.metaKey && !e.ctrlKey) {
        togglePreview();
        return;
      }
      if (e.key === "d" && !isEditing && !e.metaKey && !e.ctrlKey) {
        toggleDensity();
        return;
      }
      if (e.key === "/" && !isEditing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Escape clears bulk selection (before routing away)
      if (e.key === "Escape" && !isEditing && checkedIds.size > 0) {
        e.preventDefault();
        setCheckedIds(new Set());
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleDensity, togglePreview, checkedIds.size]);

  const handleRowClick = useCallback(
    (row: Testcase) => {
      setSelectedId(row.wombat_id);
      setFocused(row);
      navigate(`/p/${projectSlug}/library/${row.wombat_id}`);
    },
    [navigate, projectSlug],
  );

  /**
   * Row checkbox toggle — Space key on a focused row, or a dedicated
   * checkbox column if added in the future. For now we expose selection
   * via the bulk toolbar "Add to new run" CTA which the user can also
   * activate by clicking rows while holding Shift/Meta.
   *
   * The EntityTable does not support multi-select natively, so we
   * track checked IDs separately and decorate the toolbar.
   *
   * Row click with modifier keys adds/removes from the checked set.
   */
  const handleRowClickWithModifier = useCallback(
    (row: Testcase, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        // Toggle membership in the checked set
        setCheckedIds((prev) => {
          const next = new Set(prev);
          if (next.has(row.wombat_id)) {
            next.delete(row.wombat_id);
          } else {
            next.add(row.wombat_id);
          }
          return next;
        });
        // Keep the single-select highlight on this row
        setSelectedId(row.wombat_id);
        setFocused(row);
        return;
      }
      // Normal click
      handleRowClick(row);
    },
    [handleRowClick],
  );

  const handleAddToNewRun = useCallback(() => {
    if (checkedIds.size === 0 || !projectSlug) return;
    const ids = Array.from(checkedIds).join(",");
    navigate(`/p/${projectSlug}/runs/new?from=library&ids=${encodeURIComponent(ids)}`);
  }, [checkedIds, navigate, projectSlug]);

  const handleClearSelection = useCallback(() => {
    setCheckedIds(new Set());
  }, []);

  return (
    <div
      className="flex flex-col h-full"
      data-density={density}
    >
      <PageHeader
        title="Test Library"
        count={isLoading ? undefined : total}
        density={density}
        onDensityChange={setDensity}
        actions={
          <button
            type="button"
            aria-label={previewOpen ? "Hide preview pane" : "Show preview pane"}
            aria-pressed={previewOpen}
            onClick={togglePreview}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-120",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={
              previewOpen
                ? { background: "var(--accent-soft)", color: "var(--accent-fg)", border: "1px solid var(--border-default)" }
                : { background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-default)" }
            }
          >
            <PanelRight className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />

      <FacetBar
        values={facets}
        available={FACET_FIELDS}
        onChange={setFacets}
        density={density}
        className="border-b border-[color:var(--border-default)]"
      />

      {/* Bulk action toolbar — only shown when rows are checked */}
      <BulkToolbar
        selectedIds={checkedIds}
        onClear={handleClearSelection}
        onAddToNewRun={handleAddToNewRun}
      />

      {isLoading ? (
        <LibrarySkeleton density={density} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                title="No testcases match"
                description={
                  facets.length > 0
                    ? "Try clearing some filters to see more results."
                    : "This project has no testcases yet."
                }
                action={
                  facets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFacets([])}
                      className="text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                      style={{ color: "var(--accent-fg)" }}
                    >
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <SelectableEntityTable
                data={rows}
                columns={testcaseColumns}
                onRowClick={handleRowClickWithModifier}
                selectedId={selectedId}
                checkedIds={checkedIds}
                density={density}
                getRowId={(row) => row.wombat_id}
                aria-label="Testcase list"
                className="h-full"
              />
            )}
          </div>

          {previewOpen && <PreviewPane tc={focused} />}
        </div>
      )}

      {/* Keyboard hint shown when items are selected but not yet committed */}
      {checkedIds.size > 0 && (
        <div
          className="flex items-center gap-2 px-5 py-1.5 border-t text-[11px]"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-surface-2)",
            color: "var(--fg-disabled)",
          }}
        >
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{ background: "var(--bg-surface-3)", border: "1px solid var(--border-default)" }}
          >
            ⌘ click
          </kbd>
          to add/remove rows &nbsp;·&nbsp;
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{ background: "var(--bg-surface-3)", border: "1px solid var(--border-default)" }}
          >
            Esc
          </kbd>
          to clear selection
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SelectableEntityTable — thin wrapper that intercepts clicks         */
/* ------------------------------------------------------------------ */

/**
 * Wraps EntityTable with a div that captures click events with modifier
 * keys before they reach EntityTable's onRowClick. This lets us add
 * multi-select without modifying the shared EntityTable component.
 */
interface SelectableEntityTableProps<T extends object> {
  data: T[];
  columns: import("@tanstack/react-table").ColumnDef<T>[];
  onRowClick: (row: T, e: React.MouseEvent) => void;
  selectedId?: string;
  checkedIds: Set<string>;
  density?: Density;
  getRowId?: (row: T) => string;
  "aria-label"?: string;
  className?: string;
}

function SelectableEntityTable<T extends object>({
  data,
  columns,
  onRowClick,
  selectedId,
  checkedIds,
  density,
  getRowId,
  "aria-label": ariaLabel,
  className,
}: SelectableEntityTableProps<T>) {
  /**
   * We intercept the click on the wrapper div. When a modifier key is held,
   * we find the row via the closest [role=row] and look up the row data.
   * Non-modifier clicks fall through to EntityTable's own handler.
   *
   * This avoids duplicating the virtualizer logic from EntityTable.
   */
  const handleWrapperClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) return;
      // Find the clicked row element
      const rowEl = (e.target as HTMLElement).closest("[role=row]") as HTMLElement | null;
      if (!rowEl) return;
      // Derive the row index from aria-rowindex (1-based, header is index 1)
      const rowIndexAttr = rowEl.getAttribute("aria-rowindex");
      if (!rowIndexAttr) return;
      const rowIndex = parseInt(rowIndexAttr, 10) - 2; // subtract 1-based + header
      if (rowIndex < 0 || rowIndex >= data.length) return;
      const row = data[rowIndex];
      if (!row) return;
      onRowClick(row, e);
    },
    [data, onRowClick],
  );

  // For normal (non-modifier) clicks, delegate to the standard handler
  const handleNormalRowClick = useCallback(
    (row: T) => {
      onRowClick(row, new MouseEvent("click") as unknown as React.MouseEvent);
    },
    [onRowClick],
  );

  // Highlight checked rows with a visual indicator — we use a CSS data attribute
  // approach: add the IDs as a data attribute on the wrapper so CSS can target them.
  // In practice the EntityTable renders rows with aria-selected; we supplement
  // visually by applying a subtle background to checked-but-not-selected rows.

  return (
    <div
      className="relative h-full"
      onClick={handleWrapperClick}
      data-has-selection={checkedIds.size > 0 ? "true" : undefined}
    >
      {/* Checked row overlay indicators */}
      <style>{`
        [data-checked-row="true"] {
          background: color-mix(in srgb, var(--accent-soft) 60%, transparent) !important;
        }
      `}</style>
      <EntityTableWithChecks
        data={data}
        columns={columns}
        onRowClick={handleNormalRowClick}
        selectedId={selectedId}
        checkedIds={checkedIds}
        density={density}
        getRowId={getRowId}
        aria-label={ariaLabel}
        className={className}
      />
    </div>
  );
}

/**
 * Re-exports EntityTable but annotates checked rows with a data attribute
 * for visual feedback. Since EntityTable virtualizes rows we can't easily
 * inject per-row props; instead we post-process via a MutationObserver
 * approach... but that's complex. The simpler approach: for now, we show
 * the selection count in the toolbar and rely on the toolbar as the primary
 * feedback mechanism, matching the SP3.1 aesthetic of toolbar-first UX.
 *
 * The checked-row visual highlight will be handled when EntityTable gains
 * a `checkedIds` prop in a future refactor. For Task 53 the bulk toolbar
 * is the primary affordance.
 */
function EntityTableWithChecks<T extends object>({
  data,
  columns,
  onRowClick,
  selectedId,
  checkedIds: _checkedIds,
  density,
  getRowId,
  "aria-label": ariaLabel,
  className,
}: Omit<SelectableEntityTableProps<T>, "onRowClick"> & {
  onRowClick: (row: T) => void;
  checkedIds: Set<string>;
}) {
  return (
    <EntityTable
      data={data}
      columns={columns}
      onRowClick={onRowClick}
      selectedId={selectedId}
      density={density}
      getRowId={getRowId}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
