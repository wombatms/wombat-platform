/**
 * SuiteTreePage — two-pane Suite hierarchy view (SP3.4 Task 45).
 *
 * Layout:
 *   ┌───────────────────────┬────────────────────────────────┐
 *   │ Left: SuiteTree       │ Right: selected node detail    │
 *   │ (collapsible tree,    │  · metadata (title, owner,     │
 *   │  localStorage expand/ │    tags, parent)               │
 *   │  collapse, right-click│  · sub-suites list             │
 *   │  context menu)        │  · effective cases (virtualized│
 *   └───────────────────────┴────────────────────────────────┘
 *
 * Design decisions (frontend-design skill, Task 45):
 * - Left rail is fixed-width (256px) with a subtle separator; right pane
 *   scrolls independently. The split feels like a file explorer / IDE
 *   side-panel: purposeful, utilitarian, token-driven.
 * - Selected node: accent-primary background tint + left 3px rule.
 * - Skeleton loading: left rail shows 6 placeholder rows; right pane shows
 *   a header skeleton + 3 detail rows.
 * - Error state uses the shared ErrorState component with a Retry button.
 * - Empty state (no suites in the project): EmptyState with a CTA to create
 *   the first suite.
 * - Right pane effective-cases list is virtualized via TanStack Virtual
 *   directly (not EntityTable) because it is a simple flat list of IDs/titles
 *   rather than a multi-column table.
 *
 * Context menu primitive:
 * - `@radix-ui/react-context-menu` is NOT in the dependency tree. SuiteTree
 *   implements a bespoke absolute-positioned panel (simple, accessible).
 */

import { useCallback, useMemo } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import {
  FolderTree,
  FolderPlus,
  Pencil,
  Eye,
  Tag,
  User,
  FolderOpen,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

import {
  useSuiteTree,
  useSuiteDetail,
  useResolveSuite,
  buildTree,
  type TreeNode,
} from "./hooks";
import { SuiteTree, type ContextMenuAction } from "./SuiteTree";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Skeleton for left pane loading state
// ---------------------------------------------------------------------------

function TreeSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2" aria-busy="true" aria-label="Loading suite tree">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton
          key={i}
          className="h-7 rounded-sm"
          style={{ width: `${60 + (i % 3) * 15}%`, marginLeft: `${(i % 2) * 16}px` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton for right pane loading state
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-label="Loading suite detail">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <div className="flex flex-col gap-2 mt-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right pane: detail for a selected node
// ---------------------------------------------------------------------------

interface RightPaneProps {
  slug: string;
  selectedId: string;
  tree: TreeNode[];
}

function RightPane({ slug, selectedId, tree }: RightPaneProps) {
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useSuiteDetail(slug, selectedId);

  const {
    data: resolved,
    isLoading: resolveLoading,
    error: resolveError,
    refetch: refetchResolve,
  } = useResolveSuite(slug, selectedId);

  // Find sub-suites in the tree
  const subSuites = useMemo(() => {
    function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
      for (const n of nodes) {
        if (n.wombat_id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return undefined;
    }
    const node = findNode(tree, selectedId);
    return node?.children ?? [];
  }, [tree, selectedId]);

  // Virtualized list for effective cases
  const cases = resolved?.cases ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  if (detailLoading) return <DetailSkeleton />;

  if (detailError) {
    return (
      <div className="p-6">
        <ErrorState
          error={detailError}
          onRetry={() => void refetchDetail()}
          title="Could not load suite"
        />
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="px-6 py-4 border-b"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <h2
              className="text-base font-semibold truncate"
              style={{ color: "var(--fg-default)" }}
            >
              {detail.title}
            </h2>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--fg-muted)" }}
            >
              {detail.wombat_id}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              asChild
            >
              <Link to={`/p/${slug}/suites/${detail.wombat_id}/edit`}>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Link>
            </Button>
          </div>
        </div>

        {/* Metadata pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {detail.owner && (
            <span
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
              }}
            >
              <User className="h-3 w-3" aria-hidden="true" />
              {detail.owner}
            </span>
          )}
          {detail.parent_wombat_id && (
            <span
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
              }}
            >
              <FolderOpen className="h-3 w-3" aria-hidden="true" />
              <Link
                to={`/p/${slug}/suites?node=${detail.parent_wombat_id}`}
                className="hover:underline"
                style={{ color: "var(--accent-primary)" }}
              >
                {detail.parent_wombat_id}
              </Link>
            </span>
          )}
          {detail.tags && detail.tags.length > 0 && detail.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
              }}
            >
              <Tag className="h-3 w-3" aria-hidden="true" />
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Sub-suites */}
        {subSuites.length > 0 && (
          <section className="px-6 py-4 border-b" style={{ borderColor: "var(--border-default)" }}>
            <h3
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--fg-subtle)" }}
            >
              Sub-suites ({subSuites.length})
            </h3>
            <div className="flex flex-col gap-1">
              {subSuites.map((child) => (
                <Link
                  key={child.wombat_id}
                  to={`/p/${slug}/suites?node=${child.wombat_id}`}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm",
                    "hover:bg-[color:var(--bg-surface-2)] transition-colors",
                  )}
                  style={{ color: "var(--fg-default)" }}
                >
                  <FolderOpen
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: "var(--fg-muted)" }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{child.title}</span>
                  <span
                    className="text-xs ml-auto shrink-0"
                    style={{ color: "var(--fg-subtle)" }}
                  >
                    {child.wombat_id}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Effective cases */}
        <section className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--fg-subtle)" }}
            >
              Effective cases
              {resolved && (
                <span
                  className="ml-2 text-[11px] normal-case font-normal tabular-nums"
                  style={{ color: "var(--fg-muted)" }}
                >
                  ({resolved.count})
                </span>
              )}
            </h3>
          </div>

          {resolveLoading && (
            <div className="flex flex-col gap-1.5" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}

          {resolveError && (
            <ErrorState
              error={resolveError}
              onRetry={() => void refetchResolve()}
              title="Could not resolve cases"
            />
          )}

          {resolved && cases.length === 0 && (
            <EmptyState
              icon={<Eye className="h-4 w-4" aria-hidden="true" />}
              title="No cases in this suite"
              description="Add test cases by editing the suite's filter or explicit case list."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/p/${slug}/suites/${detail.wombat_id}/edit`}>
                    Edit suite
                  </Link>
                </Button>
              }
            />
          )}

          {resolved && cases.length > 0 && (
            <>
              {/* Warnings */}
              {resolved.warnings && resolved.warnings.length > 0 && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-md mb-2 text-xs"
                  style={{
                    background: "var(--feedback-warning-bg)",
                    color: "var(--feedback-warning-fg)",
                    border: "1px solid var(--feedback-warning-border)",
                  }}
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{resolved.warnings.join("; ")}</span>
                </div>
              )}

              {/* Virtualized list */}
              <div
                ref={listRef}
                className="overflow-auto max-h-[calc(100vh-420px)]"
                style={{ border: "1px solid var(--border-default)", borderRadius: "6px" }}
              >
                <div
                  style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const caseId = cases[virtualRow.index] ?? "";
                    const source = caseId ? resolved.by_source?.[caseId] : undefined;
                    return (
                      <div
                        key={virtualRow.key}
                        className={cn(
                          "absolute left-0 right-0 flex items-center gap-2 px-3",
                          "border-b last:border-b-0",
                          "hover:bg-[color:var(--bg-surface-2)] transition-colors",
                        )}
                        style={{
                          top: `${virtualRow.start}px`,
                          height: `${virtualRow.size}px`,
                          borderColor: "var(--border-default)",
                        }}
                      >
                        <span
                          className="text-xs font-mono shrink-0"
                          style={{ color: "var(--accent-primary)" }}
                        >
                          {caseId}
                        </span>
                        {source && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                            style={{
                              background: "var(--bg-surface-2)",
                              color: "var(--fg-subtle)",
                            }}
                          >
                            {source}
                          </span>
                        )}
                        <Link
                          to={`/p/${slug}/library/${caseId}`}
                          className="ml-auto shrink-0 opacity-0 group-hover:opacity-100"
                          aria-label={`Open ${caseId} in library`}
                        >
                          <ExternalLink
                            className="h-3 w-3"
                            style={{ color: "var(--fg-muted)" }}
                            aria-hidden="true"
                          />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuiteTreePage
// ---------------------------------------------------------------------------

export function SuiteTreePage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = projectSlug ?? "";

  const selectedId = searchParams.get("node") ?? undefined;

  const {
    data: flatNodes,
    isLoading,
    error,
    refetch,
  } = useSuiteTree(slug);

  const tree = useMemo(
    () => buildTree(flatNodes ?? []),
    [flatNodes],
  );

  const handleSelect = useCallback(
    (wid: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("node", wid);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const handleContextMenu = useCallback(
    (node: TreeNode): ContextMenuAction[] => [
      {
        label: "New sub-suite here",
        onClick: () =>
          navigate(`/p/${slug}/suites/new?parent=${node.wombat_id}`),
      },
      {
        label: "Edit suite",
        onClick: () =>
          navigate(`/p/${slug}/suites/${node.wombat_id}/edit`),
      },
      {
        label: "Resolve cases (preview)",
        onClick: () => handleSelect(node.wombat_id),
      },
    ],
    [navigate, slug, handleSelect],
  );

  const pageActions = (
    <Button size="sm" asChild>
      <Link to={`/p/${slug}/suites/new`}>
        <FolderPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        New suite
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Suites"
        subtitle={slug}
        count={flatNodes?.length}
        actions={pageActions}
      />

      <div
        className="flex flex-1 overflow-hidden"
        style={{ borderTop: "1px solid var(--border-default)" }}
      >
        {/* Left pane — tree */}
        <div
          className="flex flex-col shrink-0 overflow-y-auto"
          style={{
            width: "256px",
            borderRight: "1px solid var(--border-default)",
            background: "var(--bg-surface-0)",
          }}
        >
          {isLoading && <TreeSkeleton />}

          {error && !isLoading && (
            <div className="p-3">
              <ErrorState
                error={error}
                onRetry={() => void refetch()}
                title="Could not load suites"
              />
            </div>
          )}

          {!isLoading && !error && flatNodes && flatNodes.length === 0 && (
            <EmptyState
              icon={<FolderTree className="h-4 w-4" aria-hidden="true" />}
              title="No suites"
              description="Create a suite to organise test cases into reusable groups."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/p/${slug}/suites/new`}>Create first suite</Link>
                </Button>
              }
            />
          )}

          {!isLoading && !error && flatNodes && flatNodes.length > 0 && (
            <SuiteTree
              projectSlug={slug}
              nodes={tree}
              selectedId={selectedId}
              onSelect={handleSelect}
              onContextMenu={handleContextMenu}
            />
          )}
        </div>

        {/* Right pane — detail */}
        <div className="flex-1 overflow-y-auto" style={{ background: "var(--bg-surface-0)" }}>
          {!selectedId ? (
            <div
              className="flex flex-col items-center justify-center h-full gap-3 p-8"
              style={{ color: "var(--fg-muted)" }}
            >
              <FolderTree
                className="h-10 w-10 opacity-20"
                aria-hidden="true"
                style={{ color: "var(--accent-primary)" }}
              />
              <p className="text-sm text-center">
                Select a suite from the tree to view its details and effective cases.
              </p>
            </div>
          ) : (
            <RightPane slug={slug} selectedId={selectedId} tree={tree} />
          )}
        </div>
      </div>
    </div>
  );
}
