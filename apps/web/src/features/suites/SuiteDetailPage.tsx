/**
 * SuiteDetailPage — Read-only suite detail (SP3.4 Task 47).
 *
 * Design decisions from frontend-design skill (Task 47):
 * - Documentary precision aesthetic: data sheet clarity, no decorative chrome.
 *   Every element earns its place. Hierarchy via typographic weight and tokens.
 * - Breadcrumb trail built CLIENT-SIDE by walking parent_wombat_id through
 *   the flat FlatNode[] from useSuiteTree. Cap at 3 visible ancestors with
 *   an inline "···" collapse button for deeper hierarchies. Each ancestor
 *   links to /p/:slug/suites/:wid (SuiteTreePage with ?node= param).
 * - Metadata: two-row structure. Row 1: owner/tags/wombat_id pills.
 *   Row 2: stat bar — direct cases count | total count | sub-suites count.
 * - Effective cases: virtualized via TanStack Virtual, 32px compact rows.
 *   Warnings panel is an amber callout anchored above the list.
 * - Action buttons in PageHeader actions slot: "Edit" (primary) +
 *   "New sub-suite" (outline/ghost).
 * - Loading: skeleton breadcrumb + skeleton stat bar + skeleton case rows.
 * - Three page states: Loading / Empty / Error (uses shared primitives).
 *
 * Route: `/p/:projectSlug/suites/:wid`
 */

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Layers,
  Pencil,
  Tag,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";

import { buildTree, useSuiteDetail, useSuiteTree, useResolveSuite, type FlatNode, type TreeNode } from "./hooks";

// ---------------------------------------------------------------------------
// buildBreadcrumbTrail — client-side parent chain walk
// ---------------------------------------------------------------------------

interface BreadcrumbNode {
  wombat_id: string;
  title: string;
}

/**
 * Walks the flat node list to build a breadcrumb trail from root to the
 * current suite. Returns an array ordered root → current.
 *
 * Depth guard: stops at 30 iterations to prevent infinite loops in the
 * event of a cycle in the data (cycles should not exist after backend
 * validation, but we defend against stale data).
 */
function buildBreadcrumbTrail(
  flat: FlatNode[],
  wid: string,
): BreadcrumbNode[] {
  const map = new Map<string, FlatNode>();
  for (const n of flat) map.set(n.wombat_id, n);

  const trail: BreadcrumbNode[] = [];
  let current: FlatNode | undefined = map.get(wid);
  let depth = 0;

  while (current && depth < 30) {
    trail.unshift({ wombat_id: current.wombat_id, title: current.title });
    if (!current.parent_wombat_id) break;
    current = map.get(current.parent_wombat_id);
    depth++;
  }

  return trail;
}

/**
 * Count the total number of nodes in a subtree (including the root node).
 */
function countSubtree(tree: TreeNode[], wid: string): number {
  function find(nodes: TreeNode[]): TreeNode | undefined {
    for (const n of nodes) {
      if (n.wombat_id === wid) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return undefined;
  }
  function count(node: TreeNode): number {
    return 1 + node.children.reduce((sum, c) => sum + count(c), 0);
  }
  const node = find(tree);
  return node ? count(node) - 1 : 0; // subtract self → descendant suites count
}

// ---------------------------------------------------------------------------
// BreadcrumbTrail — collapses deep hierarchies
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 3; // max ancestors before collapsing with ···

interface BreadcrumbTrailProps {
  slug: string;
  trail: BreadcrumbNode[];
}

function BreadcrumbTrail({ slug, trail }: BreadcrumbTrailProps) {
  const [expanded, setExpanded] = useState(false);

  // trail[-1] is always the current suite; others are ancestors
  const ancestors = trail.slice(0, -1);
  const current = trail[trail.length - 1];

  const needsCollapse = !expanded && ancestors.length > MAX_VISIBLE;
  const visibleAncestors = needsCollapse
    ? ancestors.slice(-MAX_VISIBLE) // show only the 3 closest ancestors
    : ancestors;
  const hiddenCount = ancestors.length - visibleAncestors.length;

  return (
    <nav
      aria-label="Suite breadcrumb"
      className="flex items-center gap-1 flex-wrap text-xs px-5 py-2 border-b"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
        color: "var(--fg-muted)",
      }}
    >
      {/* Suites root link */}
      <Link
        to={`/p/${slug}/suites`}
        className="transition-colors hover:underline"
        style={{ color: "var(--fg-muted)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent-primary)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg-muted)"; }}
      >
        Suites
      </Link>

      {/* Collapsed ancestors indicator */}
      {needsCollapse && (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <button
            type="button"
            aria-label={`Show ${hiddenCount} more ancestors`}
            onClick={() => setExpanded(true)}
            className="px-1 py-0.5 rounded text-[11px] font-mono transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
            style={{
              background: "var(--bg-surface-2)",
              color: "var(--fg-muted)",
            }}
          >
            ···
          </button>
        </>
      )}

      {/* Visible ancestors */}
      {visibleAncestors.map((node) => (
        <span key={node.wombat_id} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <Link
            to={`/p/${slug}/suites?node=${node.wombat_id}`}
            className="truncate max-w-[120px] transition-colors hover:underline"
            title={node.title}
            style={{ color: "var(--fg-muted)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg-muted)"; }}
          >
            {node.title}
          </Link>
        </span>
      ))}

      {/* Current suite (non-link) */}
      {current && (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span
            className="font-medium truncate max-w-[180px]"
            aria-current="page"
            style={{ color: "var(--fg-default)" }}
          >
            {current.title}
          </span>
        </>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// StatBar — numeric summary row
// ---------------------------------------------------------------------------

interface StatBarProps {
  directCases: number;
  totalEffective: number;
  subSuiteCount: number;
}

function StatBar({ directCases, totalEffective, subSuiteCount }: StatBarProps) {
  const stats: { label: string; value: number }[] = [
    { label: "direct cases", value: directCases },
    { label: "effective total", value: totalEffective },
    { label: "sub-suites", value: subSuiteCount },
  ];

  return (
    <div className="flex items-center gap-0 divide-x divide-[color:var(--border-default)]">
      {stats.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-1.5 px-4 first:pl-0">
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: "var(--fg-default)" }}
          >
            {value.toLocaleString()}
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetadataPills — owner/tags/wombat_id
// ---------------------------------------------------------------------------

interface MetadataPillsProps {
  wombatId: string;
  owner?: string;
  tags?: string[];
  parentWid?: string | null;
  slug: string;
}

function MetadataPills({ wombatId, owner, tags, parentWid, slug }: MetadataPillsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* wombat_id */}
      <span
        className="text-xs font-mono px-2 py-0.5 rounded"
        style={{
          background: "var(--bg-surface-2)",
          color: "var(--fg-muted)",
          border: "1px solid var(--border-default)",
        }}
      >
        {wombatId}
      </span>

      {/* Owner */}
      {owner && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{
            background: "var(--bg-surface-2)",
            color: "var(--fg-muted)",
          }}
        >
          <User className="h-3 w-3" aria-hidden="true" />
          {owner}
        </span>
      )}

      {/* Parent link */}
      {parentWid && (
        <Link
          to={`/p/${slug}/suites?node=${parentWid}`}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors"
          style={{
            background: "var(--bg-surface-2)",
            color: "var(--fg-muted)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--accent-primary)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "var(--fg-muted)";
          }}
        >
          <FolderOpen className="h-3 w-3" aria-hidden="true" />
          {parentWid}
        </Link>
      )}

      {/* Tags */}
      {tags?.map((tag) => (
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
  );
}

// ---------------------------------------------------------------------------
// WarningsPanel — amber callout for resolve warnings
// ---------------------------------------------------------------------------

function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="flex items-start gap-2 px-4 py-3 rounded-md mb-3 text-xs"
      role="note"
      aria-label="Resolution warnings"
      style={{
        background: "var(--feedback-warn-bg, #fffbeb)",
        color: "var(--feedback-warn-fg, #92400e)",
        border: "1px solid var(--feedback-warn-border, #fcd34d)",
      }}
    >
      <AlertTriangle
        className="h-3.5 w-3.5 shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <ul className="flex flex-col gap-0.5 list-none m-0 p-0">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EffectiveCasesList — virtualized, compact rows
// ---------------------------------------------------------------------------

interface EffectiveCasesListProps {
  slug: string;
  cases: string[];
  bySource?: Record<string, string>;
}

function EffectiveCasesList({ slug, cases, bySource }: EffectiveCasesListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  if (cases.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="overflow-auto"
      style={{
        maxHeight: "calc(100vh - 380px)",
        minHeight: 120,
        border: "1px solid var(--border-default)",
        borderRadius: "6px",
      }}
      aria-label="Effective cases list"
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
          const source = caseId ? bySource?.[caseId] : undefined;

          return (
            <div
              key={virtualRow.key}
              className={cn(
                "absolute left-0 right-0 flex items-center gap-2 px-3 group",
                "border-b last:border-b-0",
              )}
              style={{
                top: `${virtualRow.start}px`,
                height: `${virtualRow.size}px`,
                borderColor: "var(--border-default)",
                background: "var(--bg-surface-1)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--bg-surface-1)";
              }}
            >
              {/* Case ID in monospace */}
              <span
                className="text-xs font-mono shrink-0"
                style={{ color: "var(--accent-primary)" }}
              >
                {caseId}
              </span>

              {/* Source badge */}
              {source && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    background: "var(--bg-surface-3, var(--bg-surface-2))",
                    color: "var(--fg-subtle, var(--fg-muted))",
                    border: "1px solid var(--border-subtle, var(--border-default))",
                  }}
                >
                  {source}
                </span>
              )}

              {/* Library link — visible on hover */}
              <Link
                to={`/p/${slug}/library/${caseId}`}
                className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Open ${caseId} in library`}
                tabIndex={-1}
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
  );
}

// ---------------------------------------------------------------------------
// Skeleton states
// ---------------------------------------------------------------------------

function BreadcrumbSkeleton() {
  return (
    <div
      className="flex items-center gap-2 px-5 py-2 border-b"
      aria-busy="true"
      aria-label="Loading breadcrumb"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}
    >
      {[48, 56, 80].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && <ChevronRight className="h-3 w-3 opacity-30" aria-hidden="true" />}
          <Skeleton className="h-3 rounded" style={{ width: w }} />
        </div>
      ))}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 py-4" aria-busy="true" aria-label="Loading suite header">
      <Skeleton className="h-6 w-1/3" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <div className="flex gap-6">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

function CasesSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading cases">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded-sm" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuiteDetailPage
// ---------------------------------------------------------------------------

export function SuiteDetailPage() {
  const { projectSlug, wid } = useParams<{ projectSlug: string; wid: string }>();
  const navigate = useNavigate();

  const slug = projectSlug ?? "";
  const suiteWid = wid ?? "";

  // --- Data fetching ---
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useSuiteDetail(slug, suiteWid);

  const {
    data: flatNodes,
    isLoading: treeLoading,
  } = useSuiteTree(slug);

  const {
    data: resolved,
    isLoading: resolveLoading,
    error: resolveError,
    refetch: refetchResolve,
  } = useResolveSuite(slug, suiteWid);

  // --- Derived data ---
  const tree = useMemo(
    () => buildTree(flatNodes ?? []),
    [flatNodes],
  );

  const breadcrumbTrail = useMemo(() => {
    if (!flatNodes || !suiteWid) return [];
    return buildBreadcrumbTrail(flatNodes, suiteWid);
  }, [flatNodes, suiteWid]);

  const descendantCount = useMemo(
    () => (tree.length > 0 ? countSubtree(tree, suiteWid) : 0),
    [tree, suiteWid],
  );

  const cases = resolved?.cases ?? [];
  const directCaseCount = detail?.cases?.length ?? 0;

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (detailLoading) {
    return (
      <div
        className="flex flex-col min-h-screen"
        style={{ background: "var(--bg-app)" }}
      >
        <BreadcrumbSkeleton />
        <HeaderSkeleton />
        <div className="px-5 py-4 border-t" style={{ borderColor: "var(--border-default)" }}>
          <Skeleton className="h-4 w-24 mb-3" />
          <CasesSkeleton />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (detailError) {
    return (
      <div
        className="flex flex-col min-h-screen"
        style={{ background: "var(--bg-app)" }}
      >
        <nav
          className="flex items-center px-5 py-2 border-b text-xs"
          aria-label="Breadcrumb"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}
        >
          <Link
            to={`/p/${slug}/suites`}
            className="hover:underline"
            style={{ color: "var(--fg-muted)" }}
          >
            Suites
          </Link>
        </nav>
        <div className="p-8">
          <ErrorState
            error={detailError}
            onRetry={() => void refetchDetail()}
            title="Could not load suite"
          />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  // ---------------------------------------------------------------------------
  // Actions for PageHeader
  // ---------------------------------------------------------------------------
  const pageActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(`/p/${slug}/suites/new?parent=${suiteWid}`)}
      >
        <FolderPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        New sub-suite
      </Button>
      <Button
        size="sm"
        onClick={() => navigate(`/p/${slug}/suites/${suiteWid}/edit`)}
      >
        <Pencil className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
        Edit
      </Button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className="flex flex-col min-h-screen"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Breadcrumb */}
      {treeLoading ? (
        <BreadcrumbSkeleton />
      ) : (
        <BreadcrumbTrail slug={slug} trail={breadcrumbTrail} />
      )}

      {/* Page header */}
      <PageHeader
        title={detail.title}
        subtitle={suiteWid}
        actions={pageActions}
      />

      {/* Metadata + stat bar */}
      <div
        className="px-5 py-4 border-b flex flex-col gap-4"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* Row 1: metadata pills */}
        <MetadataPills
          wombatId={suiteWid}
          owner={detail.owner}
          tags={detail.tags}
          parentWid={detail.parent_wombat_id}
          slug={slug}
        />

        {/* Row 2: stat bar */}
        <StatBar
          directCases={directCaseCount}
          totalEffective={resolved?.count ?? 0}
          subSuiteCount={descendantCount}
        />
      </div>

      {/* Effective cases section */}
      <div className="flex-1 px-5 py-5">
        {/* Section header */}
        <div className="flex items-center gap-2 mb-3">
          <Layers
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
          <h2
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Effective cases
          </h2>
          {resolved && (
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--fg-muted)" }}
            >
              ({resolved.count.toLocaleString()})
            </span>
          )}
        </div>

        {/* Loading */}
        {resolveLoading && <CasesSkeleton />}

        {/* Resolve error */}
        {resolveError && !resolveLoading && (
          <ErrorState
            error={resolveError}
            onRetry={() => void refetchResolve()}
            title="Could not resolve effective cases"
          />
        )}

        {/* Populated */}
        {resolved && !resolveLoading && (
          <>
            {/* Warnings panel */}
            {resolved.warnings && resolved.warnings.length > 0 && (
              <WarningsPanel warnings={resolved.warnings} />
            )}

            {/* Empty state */}
            {cases.length === 0 && (
              <EmptyState
                icon={<FolderTree className="h-4 w-4" aria-hidden="true" />}
                title="No effective cases"
                description="This suite has no cases yet. Add cases by editing the suite's filters or explicit case list."
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/p/${slug}/suites/${suiteWid}/edit`}>
                      Edit suite
                    </Link>
                  </Button>
                }
              />
            )}

            {/* Virtualized list */}
            {cases.length > 0 && (
              <EffectiveCasesList
                slug={slug}
                cases={cases}
                bySource={resolved.by_source}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
