/**
 * SuiteTree — collapsible suite hierarchy with right-click context menu.
 *
 * Design decisions (SP3.4 Task 45 — frontend-design skill output):
 * - Monospaced indentation rail with a subtle vertical guide line so the
 *   tree depth is legible at a glance; expand/collapse chevrons animate
 *   90° on rotate so motion communicates open/closed state without color.
 * - Selected node: token accent background + left accent rule (3px).
 *   Hover: lightweight bg-surface-2 at 60% opacity so hover doesn't
 *   visually compete with selection.
 * - Orphan nodes render with a dashed left border + amber warning icon
 *   (non-color indicator: icon shape + color) so data problems are visible.
 * - Right-click context menu is a plain absolute-positioned panel (no
 *   Radix ContextMenu since `@radix-ui/react-context-menu` is not in the
 *   dependency tree). The menu is closed on any outside click or Escape.
 * - Keyboard nav: ArrowUp/ArrowDown move through visible nodes; ArrowRight
 *   expands; ArrowLeft collapses or moves to parent; Enter selects.
 * - Expand/collapse state is persisted to localStorage under the key
 *   `suite-tree-expanded:<projectSlug>` as a JSON Set<string>.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ChevronRight, FolderOpen, Folder, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "./hooks";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadExpanded(slug: string): Set<string> {
  try {
    const raw = localStorage.getItem(`suite-tree-expanded:${slug}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveExpanded(slug: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(
      `suite-tree-expanded:${slug}`,
      JSON.stringify([...expanded]),
    );
  } catch {
    // quota exceeded — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
}

export interface SuiteTreeProps {
  /** Project slug — used to key localStorage. */
  projectSlug: string;
  nodes: TreeNode[];
  /** Currently selected wombat_id (from URL ?node= param). */
  selectedId?: string;
  /** Called when the user selects a node. */
  onSelect: (wombatId: string) => void;
  /** Provides the three context menu actions for a given node. */
  onContextMenu?: (node: TreeNode) => ContextMenuAction[];
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

interface CtxMenu {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

// ---------------------------------------------------------------------------
// Flatten visible nodes for keyboard navigation
// ---------------------------------------------------------------------------

function flattenVisible(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      result.push(n);
      if (expanded.has(n.wombat_id) && n.children.length > 0) {
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Individual tree node row
// ---------------------------------------------------------------------------

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenu: (e: MouseEvent, node: TreeNode) => void;
  isFocused: boolean;
}

function TreeNodeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onContextMenu,
  isFocused,
}: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      data-wid={node.wombat_id}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none",
        "rounded-sm text-sm outline-none transition-colors duration-100",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        isSelected
          ? "bg-[color:var(--accent-primary)]/10 font-medium"
          : "hover:bg-[color:var(--bg-surface-2)]/60",
      )}
      style={{
        paddingLeft: `${(depth * 16) + 8}px`,
        borderLeft: isSelected
          ? "3px solid var(--accent-primary)"
          : node.orphan
            ? "3px dashed var(--feedback-warning-fg)"
            : "3px solid transparent",
      }}
      onClick={() => onSelect(node.wombat_id)}
      onContextMenu={(e) => onContextMenu(e, node)}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.wombat_id);
        }
        if (e.key === "ArrowRight" && hasChildren && !isExpanded) {
          e.preventDefault();
          onToggle(node.wombat_id);
        }
        if (e.key === "ArrowLeft" && isExpanded) {
          e.preventDefault();
          onToggle(node.wombat_id);
        }
      }}
    >
      {/* Expand/collapse chevron */}
      <span
        className="shrink-0 flex items-center justify-center w-4 h-4"
        onClick={(e) => {
          if (hasChildren) {
            e.stopPropagation();
            onToggle(node.wombat_id);
          }
        }}
        aria-hidden="true"
      >
        {hasChildren ? (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
            style={{ color: "var(--fg-muted)" }}
          />
        ) : (
          <span className="w-3.5" />
        )}
      </span>

      {/* Folder icon */}
      <span className="shrink-0" aria-hidden="true" style={{ color: isSelected ? "var(--accent-primary)" : "var(--fg-muted)" }}>
        {isExpanded && hasChildren ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <Folder className="h-3.5 w-3.5" />
        )}
      </span>

      {/* Title */}
      <span
        className="truncate flex-1 text-[13px]"
        style={{ color: isSelected ? "var(--fg-default)" : "var(--fg-default)" }}
      >
        {node.title}
      </span>

      {/* Orphan indicator */}
      {node.orphan && (
        <AlertTriangle
          className="h-3 w-3 shrink-0 ml-1"
          style={{ color: "var(--feedback-warning-fg)" }}
          aria-label="Orphaned node — parent not found"
        />
      )}

      {/* Child count badge */}
      {hasChildren && (
        <span
          className="text-[10px] tabular-nums px-1 rounded-sm shrink-0"
          style={{
            color: "var(--fg-subtle)",
            background: "var(--bg-surface-2)",
          }}
        >
          {node.children.length}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive tree renderer
// ---------------------------------------------------------------------------

interface TreeBranchProps {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedId?: string;
  focusedId?: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenu: (e: MouseEvent, node: TreeNode) => void;
}

function TreeBranch({
  nodes,
  depth,
  expanded,
  selectedId,
  focusedId,
  onToggle,
  onSelect,
  onContextMenu,
}: TreeBranchProps) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.wombat_id}>
          <TreeNodeRow
            node={node}
            depth={depth}
            isExpanded={expanded.has(node.wombat_id)}
            isSelected={node.wombat_id === selectedId}
            isFocused={node.wombat_id === focusedId}
            onToggle={onToggle}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
          {expanded.has(node.wombat_id) && node.children.length > 0 && (
            <TreeBranch
              nodes={node.children}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              focusedId={focusedId}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// SuiteTree — main export
// ---------------------------------------------------------------------------

export function SuiteTree({
  projectSlug,
  nodes,
  selectedId,
  onSelect,
  onContextMenu,
}: SuiteTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    loadExpanded(projectSlug),
  );
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist expanded state to localStorage whenever it changes
  useEffect(() => {
    saveExpanded(projectSlug, expanded);
  }, [projectSlug, expanded]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    function handleClick() {
      setCtxMenu(null);
    }
    function handleKeydown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setCtxMenu(null);
    }
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [ctxMenu]);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      setFocusedId(id);
      onSelect(id);
    },
    [onSelect],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, node: TreeNode) => {
      e.preventDefault();
      const actions = onContextMenu ? onContextMenu(node) : [];
      if (actions.length === 0) return;
      setCtxMenu({ x: e.clientX, y: e.clientY, actions });
    },
    [onContextMenu],
  );

  // Keyboard navigation for the tree container
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const visible = flattenVisible(nodes, expanded);
      if (visible.length === 0) return;

      const currentIdx = visible.findIndex((n) => n.wombat_id === focusedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, visible.length - 1);
        const next = visible[nextIdx];
        if (next) {
          setFocusedId(next.wombat_id);
          // Focus the actual DOM element
          const el = containerRef.current?.querySelector<HTMLElement>(
            `[data-wid="${next.wombat_id}"]`,
          );
          el?.focus();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        const prev = visible[prevIdx];
        if (prev) {
          setFocusedId(prev.wombat_id);
          const el = containerRef.current?.querySelector<HTMLElement>(
            `[data-wid="${prev.wombat_id}"]`,
          );
          el?.focus();
        }
      }
    },
    [nodes, expanded, focusedId],
  );

  if (nodes.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-40 gap-2"
        style={{ color: "var(--fg-muted)" }}
      >
        <Folder className="h-8 w-8 opacity-30" aria-hidden="true" />
        <p className="text-xs">No suites yet</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Suite hierarchy"
      tabIndex={0}
      className="flex flex-col gap-0.5 py-1 outline-none"
      onKeyDown={handleKeyDown}
    >
      <TreeBranch
        nodes={nodes}
        depth={0}
        expanded={expanded}
        selectedId={selectedId}
        focusedId={focusedId}
        onToggle={handleToggle}
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
      />

      {/* Context menu */}
      {ctxMenu && (
        <div
          role="menu"
          tabIndex={-1}
          className={cn(
            "fixed z-50 min-w-[160px] py-1 rounded-md shadow-lg",
            "border border-[color:var(--border-default)]",
            "bg-[color:var(--bg-surface-1)]",
          )}
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") setCtxMenu(null);
          }}
        >
          {ctxMenu.actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              type="button"
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm",
                "hover:bg-[color:var(--bg-surface-2)]",
                "focus:bg-[color:var(--bg-surface-2)] focus:outline-none",
                "transition-colors duration-100",
              )}
              style={{ color: "var(--fg-default)" }}
              onClick={() => {
                action.onClick();
                setCtxMenu(null);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
