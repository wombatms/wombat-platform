/**
 * LibrarySuitesSection — SP3.4 Task 48
 *
 * Collapsible suite tree sidebar section for the Library page.
 * Rendered below the FacetBar; selecting a node appends ?suite_ref=SUITE-X
 * to the Library URL, which triggers client-side filtering of displayed
 * test cases (see LibraryPage.tsx for filtering wiring).
 *
 * Design decisions (from frontend-design skill invocation):
 * - Dense, utilitarian aesthetic: zero chrome, pure data hierarchy.
 * - Collapsed by default; chevron (right=collapsed, down=expanded) signals state.
 * - Nesting depth via left-padding (16px per level) — no connector lines,
 *   no decorative tree lines. Clean signal from indentation alone.
 * - Selected node: 3px left accent rule (same var(--accent-primary) used in
 *   EntityTable rows) for visual continuity across Library UI.
 * - Orphan nodes: TriangleAlert 12px warning icon (shape, not color-only).
 * - Loading: 3 skeleton lines that expand/fade so the height doesn't snap.
 * - Error: single inline line with a "retry" hyperlink-style button.
 * - Empty tree: brief "No suites" inline text.
 * - Selection is toggle: clicking the active node deselects (clears param).
 * - Accessible: section header is a <button> with aria-expanded; tree nodes
 *   are <button> elements with aria-selected; tree region has role="tree".
 * - DO NOT import Task 45's SuiteTree component — this agent runs in parallel.
 *   The inline tree rendering can be DRYed to import <SuiteTree> in Wave 8.
 *   TODO(sp3.4 wave 8): replace inline tree rendering with <SuiteTree> import
 *   from "@/features/suites/SuiteTree" once Task 45 is landed.
 *
 * Suite_ref filter strategy:
 * - The testcase list endpoint does not accept a suite_ref param in SP3.4.
 * - Strategy (a): client-side filtering via useResolveSuite. When a suite node
 *   is selected, we fetch its resolved case IDs, then the Library's row set is
 *   filtered to only wombat_ids present in that resolved list.
 * - This avoids backend changes. Tradeoff: resolve results may be stale until
 *   staleTime (30 s). Document as known limitation.
 *   TODO(sp3.4 follow-up): add suite_ref param to /testcases list API and
 *   switch to server-side filtering for correctness + pagination.
 */

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, ChevronDown, TriangleAlert, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSuiteTree,
  buildTree,
  useResolveSuite,
  type TreeNode,
} from "@/features/suites/hooks";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SUITE_REF_PARAM = "suite_ref";

/**
 * Read the currently selected suite_ref from URL search params.
 * Returns null when no suite is selected.
 */
export function useActiveSuiteRef(): string | null {
  const [params] = useSearchParams();
  return params.get(SUITE_REF_PARAM);
}

// ---------------------------------------------------------------------------
// LibrarySuitesSection
// ---------------------------------------------------------------------------

interface LibrarySuitesSectionProps {
  /** Project slug — forwarded to useSuiteTree. */
  projectSlug: string;
}

export function LibrarySuitesSection({ projectSlug }: LibrarySuitesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSuiteRef = searchParams.get(SUITE_REF_PARAM);

  const { data: flatNodes, isLoading, isError, refetch } = useSuiteTree(projectSlug);

  const tree = flatNodes ? buildTree(flatNodes) : [];

  const handleToggleExpanded = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleSelectNode = useCallback(
    (wid: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get(SUITE_REF_PARAM) === wid) {
            // Toggle off — deselect
            next.delete(SUITE_REF_PARAM);
          } else {
            next.set(SUITE_REF_PARAM, wid);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleRetry = useCallback(() => void refetch(), [refetch]);

  return (
    <div
      className="border-b"
      style={{ borderColor: "var(--border-default)" }}
      data-testid="library-suites-section"
    >
      {/* Section header — toggle button */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="library-suites-tree"
        onClick={handleToggleExpanded}
        className={cn(
          "flex w-full items-center gap-1.5 px-4 py-2 text-left",
          "transition-colors duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]",
        )}
        style={{
          background: expanded ? "var(--bg-surface-2)" : "var(--bg-app)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--bg-surface-2)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = expanded
            ? "var(--bg-surface-2)"
            : "var(--bg-app)";
        }}
      >
        {/* Chevron icon */}
        {expanded ? (
          <ChevronDown
            className="h-3 w-3 shrink-0 transition-transform duration-150"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
        ) : (
          <ChevronRight
            className="h-3 w-3 shrink-0 transition-transform duration-150"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
        )}

        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Suites
        </span>

        {/* Active indicator pill — visible even when collapsed */}
        {activeSuiteRef && (
          <span
            aria-label="Suite filter active"
            className="ml-auto flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold shrink-0"
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
          >
            1
          </span>
        )}
      </button>

      {/* Tree body — hidden when collapsed */}
      {expanded && (
        <div
          id="library-suites-tree"
          role="tree"
          aria-label="Suites filter tree"
          className="pb-2"
          style={{ background: "var(--bg-app)" }}
        >
          {isLoading ? (
            <SuiteTreeSkeleton />
          ) : isError ? (
            <SuiteTreeError onRetry={handleRetry} />
          ) : tree.length === 0 ? (
            <SuiteTreeEmpty />
          ) : (
            tree.map((node) => (
              <SuiteTreeNodeRow
                key={node.wombat_id}
                node={node}
                depth={0}
                activeSuiteRef={activeSuiteRef}
                onSelect={handleSelectNode}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuiteTreeNodeRow — recursive tree node
// ---------------------------------------------------------------------------

interface SuiteTreeNodeRowProps {
  node: TreeNode;
  depth: number;
  activeSuiteRef: string | null;
  onSelect: (wid: string) => void;
}

function SuiteTreeNodeRow({
  node,
  depth,
  activeSuiteRef,
  onSelect,
}: SuiteTreeNodeRowProps) {
  const [childrenExpanded, setChildrenExpanded] = useState(false);
  const isSelected = activeSuiteRef === node.wombat_id;
  const hasChildren = node.children.length > 0;

  const indentPx = 16 + depth * 16;

  const handleClick = useCallback(() => {
    onSelect(node.wombat_id);
  }, [onSelect, node.wombat_id]);

  const handleExpandToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setChildrenExpanded((v) => !v);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" && hasChildren && !childrenExpanded) {
        e.preventDefault();
        setChildrenExpanded(true);
      }
      if (e.key === "ArrowLeft" && childrenExpanded) {
        e.preventDefault();
        setChildrenExpanded(false);
      }
    },
    [hasChildren, childrenExpanded],
  );

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? childrenExpanded : undefined}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Node row */}
      <div
        className="relative flex items-center"
      >
        {/* Left accent rule when selected */}
        {isSelected && (
          <div
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: "var(--accent-primary)" }}
          />
        )}

        {/* Expand/collapse toggle for parent nodes */}
        {hasChildren ? (
          <button
            type="button"
            onClick={handleExpandToggle}
            aria-label={childrenExpanded ? "Collapse" : "Expand"}
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded",
              "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
              "transition-colors duration-100",
            )}
            style={{
              marginLeft: indentPx,
              color: "var(--fg-muted)",
            }}
          >
            {childrenExpanded ? (
              <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          /* Spacer to align leaf nodes with parent labels */
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0"
            style={{ marginLeft: indentPx }}
          />
        )}

        {/* Node label button */}
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 rounded-sm py-1 pr-3 pl-1 text-left",
            "transition-colors duration-100 outline-none",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            color: isSelected ? "var(--accent-fg)" : "var(--fg-default)",
            background: isSelected ? "var(--accent-soft)" : "transparent",
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-surface-2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }
          }}
        >
          {/* Orphan warning icon */}
          {node.orphan && (
            <TriangleAlert
              className="h-3 w-3 shrink-0"
              aria-label="Orphaned suite — parent not found"
              style={{ color: "var(--feedback-warning-fg)" }}
            />
          )}

          <span className="truncate text-[12px] font-medium leading-snug">
            {node.title}
          </span>

          {hasChildren && (
            <span
              className="ml-auto shrink-0 text-[10px] tabular-nums"
              style={{ color: "var(--fg-disabled)" }}
            >
              {node.children.length}
            </span>
          )}
        </button>
      </div>

      {/* Children */}
      {hasChildren && childrenExpanded && (
        <div role="group">
          {node.children.map((child) => (
            <SuiteTreeNodeRow
              key={child.wombat_id}
              node={child}
              depth={depth + 1}
              activeSuiteRef={activeSuiteRef}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error / empty states
// ---------------------------------------------------------------------------

function SuiteTreeSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-4 py-2" aria-label="Loading suites">
      {[64, 80, 56].map((w, i) => (
        <div
          key={i}
          className="h-3 rounded animate-pulse"
          style={{
            width: w,
            marginLeft: i * 8,
            background: "var(--bg-surface-3)",
          }}
        />
      ))}
    </div>
  );
}

function SuiteTreeError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex items-center gap-1.5 px-4 py-2 text-[11px]"
      role="alert"
    >
      <span style={{ color: "var(--feedback-error-fg)" }}>
        Failed to load suites
      </span>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "inline-flex items-center gap-0.5 underline outline-none",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] rounded-sm",
        )}
        style={{ color: "var(--accent-fg)" }}
        aria-label="Retry loading suites"
      >
        <RefreshCw className="h-2.5 w-2.5" aria-hidden="true" />
        retry
      </button>
    </div>
  );
}

function SuiteTreeEmpty() {
  return (
    <p
      className="px-4 py-2 text-[11px]"
      style={{ color: "var(--fg-disabled)" }}
    >
      No suites
    </p>
  );
}

// ---------------------------------------------------------------------------
// useLibrarySuiteFilter — hook for LibraryPage to apply the suite filter
// ---------------------------------------------------------------------------

/**
 * Returns a client-side filter function for Library rows based on the active
 * suite_ref URL param.
 *
 * Strategy (a): client-side filtering via useResolveSuite.
 * When suite_ref is set, fetch the resolved case IDs and filter the row set.
 * - While resolving: return { filtering: true, caseIds: null } — caller should
 *   keep showing previous rows.
 * - On error: return { filtering: false, caseIds: null } — no filter applied,
 *   prevents blank screen.
 * - TODO(sp3.4 follow-up): add suite_ref to /testcases API for server-side
 *   filtering (removes staleTime window risk and avoids loading all cases first).
 */
export function useLibrarySuiteFilter(projectSlug: string): {
  activeSuiteRef: string | null;
  caseIds: Set<string> | null;
  isFetchingSuiteFilter: boolean;
} {
  const [params] = useSearchParams();
  const activeSuiteRef = params.get(SUITE_REF_PARAM);

  const {
    data: resolved,
    isLoading,
  } = useResolveSuite(projectSlug, activeSuiteRef ?? "");

  if (!activeSuiteRef) {
    return { activeSuiteRef: null, caseIds: null, isFetchingSuiteFilter: false };
  }

  const caseIds = resolved ? new Set(resolved.cases) : null;
  return {
    activeSuiteRef,
    caseIds,
    isFetchingSuiteFilter: isLoading,
  };
}
