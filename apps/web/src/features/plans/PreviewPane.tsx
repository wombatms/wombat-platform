/**
 * BuilderPreviewPane — right-pane live preview for ContentBuilder (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill (Task 38):
 * - Sticky positioning: `position: sticky; top: 0; height: 100dvh` — stays fixed
 *   while the left form scrolls independently.
 * - Count badge at top: "142 matching cases" in a prominent pill.
 * - Virtualized list via TanStack Virtual for smooth rendering at 1000+ cases.
 * - Each row: wombat_id monospaced, title, source badge (filter / suite_ref / explicit),
 *   and an inline Remove button (writes to explicit_cases.remove).
 * - Removed rows show a strikethrough + Restore button instead.
 * - Loading state: spinner overlay over the existing list (not a full blank).
 * - Empty state: prompt to add filters or cases to the left form.
 * - Error state: ErrorState component with retry.
 *
 * Source badge colours follow the existing token system:
 *   filter  → accent-soft / accent-fg
 *   suite_ref → feedback-info-bg / feedback-info-fg
 *   explicit → feedback-warn-bg / feedback-warn-fg
 *
 * This component is intentionally NOT the shared PreviewPane in
 * components/shared/PreviewPane.tsx — that one is for list-page entity
 * previews. This one is specific to the ContentBuilder draft-resolve flow.
 */

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, ListFilter, RotateCcw, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ResolvedContent } from "./use-resolve-draft";

// ---------------------------------------------------------------------------
// Backend response shapes
// ---------------------------------------------------------------------------

export type SourceKind = "filter" | "suite_ref" | "explicit";

export interface ResolvedCaseRow {
  wombat_id: string;
  title: string;
  /** Which source contributed this case. */
  source: SourceKind | string;
}

interface ResolvedDraftBody {
  count?: number;
  total?: number;
  cases?: ResolvedCaseRow[];
  resolved_cases?: ResolvedCaseRow[];
  by_source?: Record<string, string>;
  warnings?: string[];
}

function normaliseDraft(data: ResolvedContent): { count: number; cases: ResolvedCaseRow[] } {
  if (!data || typeof data !== "object") return { count: 0, cases: [] };
  const body = data as ResolvedDraftBody;
  const count = body.count ?? body.total ?? 0;
  const raw = body.cases ?? body.resolved_cases ?? [];

  // If the backend uses by_source map, attach source labels.
  const bySource = body.by_source ?? {};
  const cases: ResolvedCaseRow[] = raw.map((c) => ({
    ...c,
    source: bySource[c.wombat_id] ?? c.source ?? "filter",
  }));

  return { count, cases };
}

// ---------------------------------------------------------------------------
// Source badge component
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string }) {
  let label = source;
  let fgVar = "--accent-fg";
  let bgVar = "--accent-soft";

  if (source === "filter") {
    label = "filter";
    fgVar = "--accent-fg";
    bgVar = "--accent-soft";
  } else if (source.startsWith("suite_ref")) {
    label = "suite";
    fgVar = "--feedback-info-fg";
    bgVar = "--feedback-info-bg";
  } else if (source === "explicit" || source === "explicit_add") {
    label = "explicit";
    fgVar = "--feedback-warn-fg";
    bgVar = "--feedback-warn-bg";
  }

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none rounded shrink-0"
      style={{
        background: `var(${bgVar})`,
        color: `var(${fgVar})`,
        border: `1px solid color-mix(in srgb, var(${fgVar}) 20%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CaseRow — single resolved-case row with remove/restore affordance
// ---------------------------------------------------------------------------

interface CaseRowProps {
  row: ResolvedCaseRow;
  isRemoved: boolean;
  onRemove: (wid: string) => void;
  onRestore: (wid: string) => void;
  height: number;
}

function CaseRow({ row, isRemoved, onRemove, onRestore, height }: CaseRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 border-b group",
        "transition-colors",
      )}
      style={{
        height,
        borderColor: "var(--border-subtle)",
        background: isRemoved ? "var(--bg-surface-2)" : undefined,
        opacity: isRemoved ? 0.5 : 1,
      }}
    >
      {/* Wombat ID */}
      <span
        className="shrink-0 text-[10px] font-mono tabular-nums"
        style={{ color: "var(--fg-muted)", minWidth: "5.5rem" }}
      >
        {row.wombat_id}
      </span>

      {/* Title */}
      <span
        className={cn(
          "flex-1 truncate text-xs",
          isRemoved && "line-through",
        )}
        style={{ color: isRemoved ? "var(--fg-disabled)" : "var(--fg-default)" }}
        title={row.title}
      >
        {row.title}
      </span>

      {/* Source badge */}
      <SourceBadge source={row.source} />

      {/* Remove / Restore button — visible on hover or when removed */}
      <button
        type="button"
        aria-label={isRemoved ? `Restore ${row.wombat_id}` : `Remove ${row.wombat_id} from plan`}
        onClick={() => isRemoved ? onRestore(row.wombat_id) : onRemove(row.wombat_id)}
        className={cn(
          "shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium",
          "transition-all outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          !isRemoved && "opacity-0 group-hover:opacity-100",
        )}
        style={{
          background: isRemoved ? "var(--feedback-success-bg)" : "var(--feedback-error-bg)",
          color: isRemoved ? "var(--feedback-success-fg)" : "var(--feedback-error-fg)",
          border: isRemoved
            ? "1px solid color-mix(in srgb, var(--feedback-success-fg) 20%, transparent)"
            : "1px solid color-mix(in srgb, var(--feedback-error-fg) 20%, transparent)",
        }}
      >
        {isRemoved
          ? <><RotateCcw className="h-2.5 w-2.5" aria-hidden="true" /> Restore</>
          : <><X className="h-2.5 w-2.5" aria-hidden="true" /> Remove</>
        }
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows — shown while the first resolve is in flight
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading preview">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 border-b"
          style={{
            height: 36,
            borderColor: "var(--border-subtle)",
          }}
        >
          <div
            className="rounded shrink-0 animate-pulse"
            style={{
              width: 60,
              height: 10,
              background: "var(--bg-surface-3)",
            }}
          />
          <div
            className="flex-1 rounded animate-pulse"
            style={{
              height: 10,
              background: "var(--bg-surface-2)",
            }}
          />
          <div
            className="rounded shrink-0 animate-pulse"
            style={{
              width: 36,
              height: 14,
              background: "var(--bg-surface-3)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuilderPreviewPane
// ---------------------------------------------------------------------------

interface BuilderPreviewPaneProps {
  resolveQuery: UseQueryResult<ResolvedContent>;
  kind: "plan" | "suite";
  onRemove: (wid: string) => void;
  onRestore: (wid: string) => void;
  /** Current set of explicitly-removed wombat IDs (from ContentBuilder body). */
  removedIds: string[];
}

const ROW_HEIGHT = 36;

export function BuilderPreviewPane({
  resolveQuery,
  kind,
  onRemove,
  onRestore,
  removedIds,
}: BuilderPreviewPaneProps) {
  const { data, isLoading, isFetching, isError, error, refetch } = resolveQuery;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Normalise the server response into a flat case list.
  const { count, cases } = data ? normaliseDraft(data) : { count: 0, cases: [] };

  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <aside
      aria-label="Live preview"
      className="flex flex-col overflow-hidden border-l"
      style={{
        // Sticky: fills the viewport height so the right pane never scrolls away.
        position: "sticky",
        top: 0,
        height: "100dvh",
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Preview header: count badge + fetching indicator                 */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-1)",
        }}
      >
        <div className="flex items-center gap-2">
          <ListFilter
            className="h-3.5 w-3.5"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
          <span
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--fg-muted)" }}
          >
            Preview
          </span>
        </div>

        {/* Count badge */}
        {Boolean(data) && !isError && (
          <div
            className="flex items-center gap-1.5"
            aria-live="polite"
            aria-label={`${count} matching cases`}
          >
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums"
              style={{
                background: count > 0 ? "var(--accent-soft)" : "var(--bg-surface-2)",
                color: count > 0 ? "var(--accent-fg)" : "var(--fg-muted)",
              }}
            >
              {count.toLocaleString()}
            </span>
            <span className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
              {count === 1 ? "case" : "cases"}
            </span>
          </div>
        )}

        {/* Fetching spinner (subsequent fetches — not the first load) */}
        {isFetching && !isLoading && (
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            aria-hidden="true"
            style={{ color: "var(--accent-primary)" }}
          />
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Preview body                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="relative flex-1 overflow-hidden">
        {/* Loading overlay on first load */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--bg-surface-1) 80%, transparent)" }}>
            <div className="flex flex-col items-center gap-2">
              <Loader2
                className="h-5 w-5 animate-spin"
                style={{ color: "var(--accent-primary)" }}
                aria-hidden="true"
              />
              <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
                Resolving…
              </span>
            </div>
          </div>
        )}

        {/* Fetching spinner overlay on subsequent fetches (keeps old list visible) */}
        {isFetching && !isLoading && Boolean(data) && (
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              background: "color-mix(in srgb, var(--bg-surface-1) 30%, transparent)",
            }}
          >
            <div className="absolute top-2 right-2">
              <Loader2
                className="h-4 w-4 animate-spin"
                style={{ color: "var(--accent-primary)" }}
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <AlertCircle
              className="h-5 w-5"
              aria-hidden="true"
              style={{ color: "var(--feedback-error-fg)" }}
            />
            <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
              {error instanceof Error ? error.message : "Failed to resolve preview"}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-xs px-3 py-1.5 rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-muted)",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state — no data yet (form not filled in) */}
        {!isLoading && !isError && data == null && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <ListFilter
              className="h-6 w-6 opacity-25"
              aria-hidden="true"
              style={{ color: "var(--fg-muted)" }}
            />
            <p className="text-xs max-w-[220px]" style={{ color: "var(--fg-disabled)" }}>
              Add{" "}
              {kind === "plan"
                ? "filters, suite references, or explicit cases"
                : "filters or explicit cases"}{" "}
              to see a live preview here.
            </p>
          </div>
        )}

        {/* Empty resolved state — data loaded but count = 0 */}
        {!isLoading && !isError && Boolean(data) && count === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: "var(--fg-disabled)" }}
            >
              0
            </span>
            <p className="text-xs max-w-[220px]" style={{ color: "var(--fg-disabled)" }}>
              No cases match the current filters. Try broadening your criteria.
            </p>
          </div>
        )}

        {/* Skeleton rows during first load */}
        {isLoading && !data && <SkeletonRows />}

        {/* Virtualized case list */}
        {!isError && cases.length > 0 && (
          <div
            ref={scrollRef}
            className="overflow-y-auto"
            style={{ height: "100%" }}
            aria-label={`${count} resolved cases`}
          >
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((vItem) => {
                const row = cases[vItem.index];
                if (!row) return null;
                return (
                  <div
                    key={vItem.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    <CaseRow
                      row={row}
                      isRemoved={removedIds.includes(row.wombat_id)}
                      onRemove={onRemove}
                      onRestore={onRestore}
                      height={ROW_HEIGHT}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Footer: warnings                                                  */}
      {/* ---------------------------------------------------------------- */}
      {data && (data as { warnings?: string[] }).warnings?.length ? (
        <div
          className="shrink-0 px-4 py-2 border-t text-[11px]"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--feedback-warn-bg)",
            color: "var(--feedback-warn-fg)",
          }}
        >
          {(data as { warnings?: string[] }).warnings!.length} warning
          {(data as { warnings?: string[] }).warnings!.length > 1 ? "s" : ""} — unknown IDs in explicit list
        </div>
      ) : null}
    </aside>
  );
}
