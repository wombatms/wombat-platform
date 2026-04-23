/**
 * Suite data-fetching hooks + buildTree helper (SP3.4).
 *
 * Query keys come from `@/api/query-keys` (Task 31). If that module is not
 * available yet (parallel authoring), a local fallback is used so this module
 * compiles independently. The fallback keys are structurally identical to what
 * Task 31 will produce; a TODO marks the import so it can be switched once the
 * file lands.
 *
 * Orphan handling: nodes whose `parent_wombat_id` is not null but whose parent
 * is absent from the flat list are surfaced as roots. They receive
 * `orphan: true` in their TreeNode so callers can render a visual indicator
 * (e.g. a dashed border, a warning icon). A `console.warn` is also emitted
 * once per `buildTree` call (keyed on the number of orphans found) to assist
 * debugging. We chose roots-with-marker over throwing because partial trees
 * are better than a blank screen, and the parent may exist in a future refresh.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Query keys — prefer @/api/query-keys once Task 31 lands.
// ---------------------------------------------------------------------------

// TODO(sp3.4): Replace this inline fallback with:
//   import { suiteKeys } from "@/api/query-keys";
// once apps/web/src/api/query-keys.ts exists.
const suiteKeys = {
  all: (slug: string) => ["suites", slug] as const,
  tree: (slug: string) => ["suites", slug, "tree"] as const,
  detail: (slug: string, wid: string) => ["suites", slug, wid] as const,
  resolve: (slug: string, wid: string) =>
    ["suites", slug, wid, "resolve"] as const,
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Shape of one node as returned by GET /api/projects/{slug}/suites/tree */
export interface FlatNode {
  wombat_id: string;
  title: string;
  parent_wombat_id: string | null;
}

/** A node in the nested tree produced by buildTree. */
export interface TreeNode extends FlatNode {
  /** True when the node's declared parent_wombat_id was not present in the flat list. */
  orphan?: true;
  children: TreeNode[];
}

/** Shape of a suite detail response. */
export interface SuiteDetail {
  wombat_id: string;
  title: string;
  parent_wombat_id: string | null;
  owner?: string;
  tags?: string[];
  cases?: string[];
  include?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/** Shape of a suite resolve response (effective case list for the subtree). */
export interface ResolvedSuite {
  wombat_id: string;
  title: string;
  cases: string[];
  count: number;
  by_source?: Record<string, string>;
  warnings?: string[];
}

/** Flat list wrapped in { nodes: [...] } as the backend returns. */
interface SuiteTreeResponse {
  nodes: FlatNode[];
}

// ---------------------------------------------------------------------------
// buildTree — pure function
// ---------------------------------------------------------------------------

/**
 * Converts a flat node list (as returned by the /suites/tree endpoint) into a
 * nested `TreeNode[]` tree.
 *
 * Ordering: siblings are sorted alphabetically by `title`, falling back to
 * `wombat_id` if titles are identical. This makes the tree deterministic and
 * stable across re-renders.
 *
 * Orphan handling: if a node's `parent_wombat_id` is non-null but no node
 * with that ID exists in the list, the node is placed at the root level with
 * `orphan: true`. A single `console.warn` is emitted per call listing all
 * orphaned IDs so developers can detect data inconsistencies without crashing
 * the UI.
 */
export function buildTree(nodes: FlatNode[]): TreeNode[] {
  if (nodes.length === 0) return [];

  // Build a lookup map for O(1) parent resolution.
  const nodeMap = new Map<string, TreeNode>();
  for (const n of nodes) {
    nodeMap.set(n.wombat_id, { ...n, children: [] });
  }

  const roots: TreeNode[] = [];
  const orphanIds: string[] = [];

  for (const treeNode of nodeMap.values()) {
    if (treeNode.parent_wombat_id === null) {
      roots.push(treeNode);
    } else {
      const parent = nodeMap.get(treeNode.parent_wombat_id);
      if (parent) {
        parent.children.push(treeNode);
      } else {
        // Parent referenced but not present — surface as root with orphan marker.
        orphanIds.push(treeNode.wombat_id);
        const orphanNode: TreeNode = { ...treeNode, orphan: true };
        roots.push(orphanNode);
        // Replace the entry in the map so children of the orphan still resolve.
        nodeMap.set(treeNode.wombat_id, orphanNode);
      }
    }
  }

  if (orphanIds.length > 0) {
    console.warn(
      `[buildTree] ${orphanIds.length} orphan node(s) promoted to root ` +
        `(parent_wombat_id not found in list): ${orphanIds.join(", ")}`,
    );
  }

  // Sort comparator: alphabetical title, wombat_id as tiebreaker.
  const compare = (a: TreeNode, b: TreeNode): number =>
    a.title.localeCompare(b.title) || a.wombat_id.localeCompare(b.wombat_id);

  // Recursively sort children.
  function sortChildren(nodes: TreeNode[]): void {
    nodes.sort(compare);
    for (const n of nodes) sortChildren(n.children);
  }

  sortChildren(roots);
  return roots;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch the flat node list for the suite tree.
 *
 * Returns the raw `FlatNode[]` (not a nested tree). Callers pass the array to
 * `buildTree` when they need the nested form — keeping data-fetching and
 * tree-construction separate makes each independently testable.
 *
 * staleTime: 60 s — tree structure changes infrequently.
 */
export function useSuiteTree(slug: string) {
  return useQuery({
    queryKey: suiteKeys.tree(slug),
    queryFn: async (): Promise<FlatNode[]> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/suites/tree",
        { params: { path: { project_slug: slug } } },
      );
      if (error) throw error;
      // The backend wraps the list: { nodes: [...] }
      const body = data as unknown as SuiteTreeResponse | FlatNode[];
      if (body && typeof body === "object" && "nodes" in body) {
        return (body as SuiteTreeResponse).nodes;
      }
      // Fallback: some versions may return the array directly.
      return body as FlatNode[];
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/**
 * Fetch detail for a single suite.
 *
 * staleTime: 30 s — matches the project-wide default.
 */
export function useSuiteDetail(slug: string, wid: string) {
  return useQuery({
    queryKey: suiteKeys.detail(slug, wid),
    queryFn: async (): Promise<SuiteDetail> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/suites/{wombat_id}",
        { params: { path: { project_slug: slug, wombat_id: wid } } },
      );
      if (error) throw error;
      return data as SuiteDetail;
    },
    enabled: Boolean(slug && wid),
    staleTime: 30_000,
  });
}

/**
 * Fetch the resolved (effective) case list for a suite and its full subtree.
 *
 * staleTime: 30 s.
 */
export function useResolveSuite(slug: string, wid: string) {
  return useQuery({
    queryKey: suiteKeys.resolve(slug, wid),
    queryFn: async (): Promise<ResolvedSuite> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/suites/{wombat_id}/resolve",
        { params: { path: { project_slug: slug, wombat_id: wid } } },
      );
      if (error) throw error;
      return data as ResolvedSuite;
    },
    enabled: Boolean(slug && wid),
    staleTime: 30_000,
  });
}
