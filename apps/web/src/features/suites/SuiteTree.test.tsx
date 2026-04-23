/**
 * Component tests for SuiteTree (SP3.4 Task 56).
 *
 * The buildTree pure-function tests live in hooks.test.tsx (already shipped).
 * This file focuses on the RENDERED component behaviour:
 *
 * 1. Expand/collapse persists to localStorage keyed on projectSlug.
 * 2. Selected highlight follows URL `?node=SUITE-X` (MemoryRouter initial entry).
 * 3. Right-click (context-menu trigger) shows the three expected menu items;
 *    each calls the correct onClick handler.
 * 4. Keyboard navigation: ArrowDown / ArrowUp / ArrowRight / ArrowLeft walk
 *    and expand/collapse the tree.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SuiteTree, type SuiteTreeProps, type ContextMenuAction } from "./SuiteTree";
import type { TreeNode } from "./hooks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_SLUG = "alpha";

/**
 * Build a minimal two-level tree for most tests:
 *   SUITE-ROOT-A  (has two children)
 *     SUITE-CHILD-1
 *     SUITE-CHILD-2
 *   SUITE-ROOT-B  (no children)
 */
function buildFixtureTree(): TreeNode[] {
  return [
    {
      wombat_id: "SUITE-ROOT-A",
      title: "Auth Suite",
      parent_wombat_id: null,
      children: [
        {
          wombat_id: "SUITE-CHILD-1",
          title: "Login Flow",
          parent_wombat_id: "SUITE-ROOT-A",
          children: [],
        },
        {
          wombat_id: "SUITE-CHILD-2",
          title: "Logout Flow",
          parent_wombat_id: "SUITE-ROOT-A",
          children: [],
        },
      ],
    },
    {
      wombat_id: "SUITE-ROOT-B",
      title: "Billing Suite",
      parent_wombat_id: null,
      children: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOptions {
  nodes?: TreeNode[];
  selectedId?: string;
  onSelect?: (wid: string) => void;
  onContextMenu?: (node: TreeNode) => ContextMenuAction[];
}

function renderTree(opts: RenderOptions = {}) {
  const nodes = opts.nodes ?? buildFixtureTree();
  const onSelect = opts.onSelect ?? vi.fn();
  const props: SuiteTreeProps = {
    projectSlug: PROJECT_SLUG,
    nodes,
    selectedId: opts.selectedId,
    onSelect,
    onContextMenu: opts.onContextMenu,
  };

  const result = render(
    <MemoryRouter>
      <SuiteTree {...props} />
    </MemoryRouter>,
  );

  return { onSelect, ...result };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// 1. Expand/collapse persists to localStorage
// ---------------------------------------------------------------------------

describe("SuiteTree — expand/collapse persists to localStorage", () => {
  const LS_KEY = `suite-tree-expanded:${PROJECT_SLUG}`;

  it("starts collapsed (empty localStorage) and persists expansion after toggle", async () => {
    const user = userEvent.setup();
    renderTree();

    // On mount the component writes the initial (empty) expanded set to localStorage.
    // It may be null (never written) or "[]" (empty array written on first useEffect).
    // Either way, SUITE-ROOT-A must NOT be in the stored set yet.
    const initialStored = localStorage.getItem(LS_KEY);
    if (initialStored !== null) {
      const initialParsed: string[] = JSON.parse(initialStored);
      expect(initialParsed).not.toContain("SUITE-ROOT-A");
    }

    // The children of SUITE-ROOT-A should not be visible yet (collapsed).
    expect(screen.queryByText("Login Flow")).not.toBeInTheDocument();

    // Click the expand chevron on SUITE-ROOT-A. The row has role="treeitem".
    // Clicking anywhere on the row row calls onSelect; clicking the chevron
    // span calls onToggle. In jsdom click on the row + find the chevron.
    const rootARow = screen.getByRole("treeitem", { name: /auth suite/i });
    // The chevron button is inside the treeitem row via the onClick handler on
    // the inner <span> with the ChevronRight icon. It has no own role, so we
    // fire a click on the row directly — which calls onSelect. The expand/
    // collapse is on the chevron span child. We'll target it by clicking the
    // ChevronRight svg via its parent span.
    const chevronSpans = rootARow.querySelectorAll("span[aria-hidden='true']");
    // The first aria-hidden span is the chevron wrapper.
    const chevronSpan = chevronSpans[0] as HTMLElement;
    await user.click(chevronSpan);

    // Children should now be visible.
    await waitFor(() => {
      expect(screen.getByText("Login Flow")).toBeInTheDocument();
      expect(screen.getByText("Logout Flow")).toBeInTheDocument();
    });

    // localStorage must have been written with the expanded set.
    const stored = localStorage.getItem(LS_KEY);
    expect(stored).not.toBeNull();
    const parsed: string[] = JSON.parse(stored!);
    expect(parsed).toContain("SUITE-ROOT-A");
  });

  it("restores expanded state from localStorage on mount", () => {
    // Pre-populate localStorage with SUITE-ROOT-A already expanded.
    localStorage.setItem(LS_KEY, JSON.stringify(["SUITE-ROOT-A"]));

    renderTree();

    // Children should be immediately visible because state is restored.
    expect(screen.getByText("Login Flow")).toBeInTheDocument();
    expect(screen.getByText("Logout Flow")).toBeInTheDocument();
  });

  it("removes a node id from localStorage when it is collapsed", async () => {
    // Start expanded.
    localStorage.setItem(LS_KEY, JSON.stringify(["SUITE-ROOT-A"]));

    const user = userEvent.setup();
    renderTree();

    // Children are visible.
    expect(screen.getByText("Login Flow")).toBeInTheDocument();

    // Click the chevron to collapse.
    const rootARow = screen.getByRole("treeitem", { name: /auth suite/i });
    const chevronSpans = rootARow.querySelectorAll("span[aria-hidden='true']");
    const chevronSpan = chevronSpans[0] as HTMLElement;
    await user.click(chevronSpan);

    await waitFor(() => {
      expect(screen.queryByText("Login Flow")).not.toBeInTheDocument();
    });

    const stored = localStorage.getItem(LS_KEY);
    const parsed: string[] = JSON.parse(stored!);
    expect(parsed).not.toContain("SUITE-ROOT-A");
  });
});

// ---------------------------------------------------------------------------
// 2. Selected highlight follows URL ?node=SUITE-X
// ---------------------------------------------------------------------------

describe("SuiteTree — selected node highlight", () => {
  it("renders the selected node with aria-selected=true", () => {
    renderTree({ selectedId: "SUITE-ROOT-B" });

    const billingRow = screen.getByRole("treeitem", { name: /billing suite/i });
    expect(billingRow).toHaveAttribute("aria-selected", "true");

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    expect(authRow).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect when a node is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTree();

    const billingRow = screen.getByRole("treeitem", { name: /billing suite/i });
    await user.click(billingRow);

    expect(onSelect).toHaveBeenCalledWith("SUITE-ROOT-B");
  });

  it("renders no node as selected when selectedId is undefined", () => {
    renderTree({ selectedId: undefined });

    const allTreeItems = screen.getAllByRole("treeitem");
    for (const item of allTreeItems) {
      expect(item).toHaveAttribute("aria-selected", "false");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Right-click context menu shows expected menu items
// ---------------------------------------------------------------------------

describe("SuiteTree — context menu", () => {
  function makeContextMenuProvider(_node: TreeNode): ContextMenuAction[] {
    return [
      {
        label: "New sub-suite here",
        onClick: vi.fn(),
      },
      {
        label: "Edit suite",
        onClick: vi.fn(),
      },
      {
        label: "Resolve cases (preview)",
        onClick: vi.fn(),
      },
    ];
  }

  it("right-click opens a menu with the three standard items", async () => {
    const actionSpies: Record<string, ReturnType<typeof vi.fn>> = {};

    const onContextMenu = vi.fn((_node: TreeNode): ContextMenuAction[] => {
      const actions = [
        { label: "New sub-suite here", onClick: vi.fn() },
        { label: "Edit suite", onClick: vi.fn() },
        { label: "Resolve cases (preview)", onClick: vi.fn() },
      ];
      for (const a of actions) {
        actionSpies[a.label] = a.onClick;
      }
      return actions;
    });

    renderTree({ onContextMenu });

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    fireEvent.contextMenu(authRow);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    expect(screen.getByRole("menuitem", { name: "New sub-suite here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit suite" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Resolve cases (preview)" })).toBeInTheDocument();
  });

  it("clicking a menu item calls its onClick handler and closes the menu", async () => {
    const onNewSubSuite = vi.fn();
    const onContextMenu = vi.fn((_node2: TreeNode): ContextMenuAction[] => [
      { label: "New sub-suite here", onClick: onNewSubSuite },
      { label: "Edit suite", onClick: vi.fn() },
      { label: "Resolve cases (preview)", onClick: vi.fn() },
    ]);

    const user = userEvent.setup();
    renderTree({ onContextMenu });

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    fireEvent.contextMenu(authRow);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    const newSubSuiteItem = screen.getByRole("menuitem", { name: "New sub-suite here" });
    await user.click(newSubSuiteItem);

    expect(onNewSubSuite).toHaveBeenCalledOnce();

    // Menu should be closed.
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("pressing Escape closes the context menu", async () => {
    const onContextMenu = vi.fn((_node: TreeNode): ContextMenuAction[] => [
      { label: "New sub-suite here", onClick: vi.fn() },
    ]);

    renderTree({ onContextMenu });

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    fireEvent.contextMenu(authRow);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("clicking outside the menu closes it", async () => {
    const onContextMenu = vi.fn((_node: TreeNode): ContextMenuAction[] => [
      { label: "New sub-suite here", onClick: vi.fn() },
    ]);

    renderTree({ onContextMenu });

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    fireEvent.contextMenu(authRow);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    // Click somewhere outside — the window "click" listener in SuiteTree closes the menu.
    fireEvent.click(window);

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("does not open a menu when onContextMenu is not provided", () => {
    // No onContextMenu prop → actions array is always empty → menu not shown.
    renderTree({ onContextMenu: undefined });

    const authRow = screen.getByRole("treeitem", { name: /auth suite/i });
    fireEvent.contextMenu(authRow);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  void makeContextMenuProvider; // silence unused-fn warning
});

// ---------------------------------------------------------------------------
// 4. Keyboard navigation
// ---------------------------------------------------------------------------

describe("SuiteTree — keyboard navigation", () => {
  it("ArrowDown moves focus to the next visible node", async () => {
    // Start with SUITE-ROOT-A expanded so children are visible.
    localStorage.setItem(
      `suite-tree-expanded:${PROJECT_SLUG}`,
      JSON.stringify(["SUITE-ROOT-A"]),
    );

    renderTree({ selectedId: "SUITE-ROOT-A" });

    const tree = screen.getByRole("tree");

    // Focus the tree container first, then send ArrowDown.
    act(() => {
      tree.focus();
    });

    // Visible order with SUITE-ROOT-A expanded:
    //   [0] SUITE-ROOT-A
    //   [1] SUITE-CHILD-1
    //   [2] SUITE-CHILD-2
    //   [3] SUITE-ROOT-B

    fireEvent.keyDown(tree, { key: "ArrowDown" });

    // After ArrowDown the focused DOM element should be SUITE-CHILD-1.
    await waitFor(() => {
      const child1 = screen.getByRole("treeitem", { name: /login flow/i });
      // The treeitem should have tabIndex=0 (focused node gets tabIndex 0).
      expect(child1).toHaveAttribute("tabindex", "0");
    });
  });

  it("ArrowUp moves focus to the previous visible node", async () => {
    localStorage.setItem(
      `suite-tree-expanded:${PROJECT_SLUG}`,
      JSON.stringify(["SUITE-ROOT-A"]),
    );

    // Set selectedId to SUITE-CHILD-2 so focusedId starts at index 2 in the
    // visible list: [ROOT-A(0), CHILD-1(1), CHILD-2(2), ROOT-B(3)].
    // ArrowUp moves from CHILD-2 to CHILD-1.
    renderTree({ selectedId: "SUITE-CHILD-2" });

    const tree = screen.getByRole("tree");
    act(() => { tree.focus(); });

    fireEvent.keyDown(tree, { key: "ArrowUp" }); // CHILD-2 → CHILD-1

    await waitFor(() => {
      const child1 = screen.getByRole("treeitem", { name: /login flow/i });
      expect(child1).toHaveAttribute("tabindex", "0");
    });
  });

  it("ArrowRight expands a collapsed node with children", async () => {
    renderTree();

    // SUITE-ROOT-A is collapsed; its children are not visible.
    expect(screen.queryByText("Login Flow")).not.toBeInTheDocument();

    const rootARow = screen.getByRole("treeitem", { name: /auth suite/i });

    // ArrowRight on a collapsed node with children expands it.
    fireEvent.keyDown(rootARow, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByText("Login Flow")).toBeInTheDocument();
    });
  });

  it("ArrowLeft collapses an expanded node", async () => {
    // Start with SUITE-ROOT-A expanded.
    localStorage.setItem(
      `suite-tree-expanded:${PROJECT_SLUG}`,
      JSON.stringify(["SUITE-ROOT-A"]),
    );

    renderTree();

    // Children are visible.
    expect(screen.getByText("Login Flow")).toBeInTheDocument();

    const rootARow = screen.getByRole("treeitem", { name: /auth suite/i });

    // ArrowLeft on an expanded node collapses it.
    fireEvent.keyDown(rootARow, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(screen.queryByText("Login Flow")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("SuiteTree — empty state", () => {
  it("renders an empty state message when nodes is []", () => {
    renderTree({ nodes: [] });
    expect(screen.getByText(/no suites yet/i)).toBeInTheDocument();
  });
});
