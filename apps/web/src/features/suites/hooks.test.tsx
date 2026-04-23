/**
 * Tests for suites hooks and buildTree helper (SP3.4).
 *
 * Hook tests use MSW + renderHook. buildTree tests are pure-function unit tests
 * that do not require a React environment.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "@/tests/msw/server";
import {
  buildTree,
  useSuiteTree,
  useSuiteDetail,
  useResolveSuite,
  type FlatNode,
} from "./hooks";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Provide a valid access token so auth middleware doesn't redirect.
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
});

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const SLUG = "alpha-project";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FLAT_NODES: FlatNode[] = [
  { wombat_id: "SUITE-ROOT-A", title: "Auth Suite", parent_wombat_id: null },
  { wombat_id: "SUITE-ROOT-B", title: "Billing Suite", parent_wombat_id: null },
  {
    wombat_id: "SUITE-CHILD-1",
    title: "Login Flow",
    parent_wombat_id: "SUITE-ROOT-A",
  },
  {
    wombat_id: "SUITE-CHILD-2",
    title: "Logout Flow",
    parent_wombat_id: "SUITE-ROOT-A",
  },
];

const SUITE_DETAIL = {
  wombat_id: "SUITE-ROOT-A",
  title: "Auth Suite",
  parent_wombat_id: null,
  owner: "@alice",
  tags: ["auth"],
  cases: ["TC-001", "TC-002"],
};

const RESOLVED_SUITE = {
  wombat_id: "SUITE-ROOT-A",
  title: "Auth Suite",
  cases: ["TC-001", "TC-002", "TC-010"],
  count: 3,
};

// Register MSW handlers for suite endpoints.
beforeEach(() => {
  server.use(
    http.get("*/api/projects/:project_slug/suites/tree", () => {
      return HttpResponse.json({ nodes: FLAT_NODES });
    }),

    http.get(
      "*/api/projects/:project_slug/suites/:wombat_id/resolve",
      ({ params }) => {
        if (params["wombat_id"] === "SUITE-ROOT-A") {
          return HttpResponse.json(RESOLVED_SUITE);
        }
        return HttpResponse.json(
          {
            error: {
              code: "not_found",
              message: "Suite not found.",
              field: null,
              hint: null,
            },
          },
          { status: 404 },
        );
      },
    ),

    http.get(
      "*/api/projects/:project_slug/suites/:wombat_id",
      ({ params }) => {
        if (params["wombat_id"] === "SUITE-ROOT-A") {
          return HttpResponse.json(SUITE_DETAIL);
        }
        return HttpResponse.json(
          {
            error: {
              code: "not_found",
              message: "Suite not found.",
              field: null,
              hint: null,
            },
          },
          { status: 404 },
        );
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// buildTree — pure function tests
// ---------------------------------------------------------------------------

describe("buildTree", () => {
  it("returns [] for an empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("builds a 2-level tree correctly", () => {
    const nodes: FlatNode[] = [
      { wombat_id: "ROOT", title: "Root", parent_wombat_id: null },
      { wombat_id: "CHILD-1", title: "Child 1", parent_wombat_id: "ROOT" },
      { wombat_id: "CHILD-2", title: "Child 2", parent_wombat_id: "ROOT" },
    ];

    const tree = buildTree(nodes);

    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.wombat_id).toBe("ROOT");
    expect(root.children).toHaveLength(2);
    const ids = root.children.map((c) => c.wombat_id);
    expect(ids).toContain("CHILD-1");
    expect(ids).toContain("CHILD-2");
  });

  it("handles 3-level nesting", () => {
    const nodes: FlatNode[] = [
      { wombat_id: "L1", title: "Level 1", parent_wombat_id: null },
      { wombat_id: "L2", title: "Level 2", parent_wombat_id: "L1" },
      { wombat_id: "L3", title: "Level 3", parent_wombat_id: "L2" },
    ];

    const tree = buildTree(nodes);

    expect(tree).toHaveLength(1);
    const l1 = tree[0]!;
    expect(l1.children).toHaveLength(1);
    const l2 = l1.children[0]!;
    expect(l2.wombat_id).toBe("L2");
    expect(l2.children).toHaveLength(1);
    const l3 = l2.children[0]!;
    expect(l3.wombat_id).toBe("L3");
    expect(l3.children).toHaveLength(0);
  });

  it("surfaces orphan nodes (parent not in list) as roots with orphan:true", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const nodes: FlatNode[] = [
      {
        wombat_id: "ORPHAN",
        title: "Orphan",
        parent_wombat_id: "MISSING-PARENT",
      },
      { wombat_id: "NORMAL", title: "Normal", parent_wombat_id: null },
    ];

    const tree = buildTree(nodes);

    // Both show up as roots.
    expect(tree).toHaveLength(2);
    const orphanNode = tree.find((n) => n.wombat_id === "ORPHAN");
    expect(orphanNode).toBeDefined();
    expect(orphanNode?.orphan).toBe(true);

    const normalNode = tree.find((n) => n.wombat_id === "NORMAL");
    expect(normalNode?.orphan).toBeUndefined();

    // A console.warn must be emitted.
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("orphan");

    warnSpy.mockRestore();
  });

  it("does not emit a warn when there are no orphans", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    buildTree([
      { wombat_id: "ROOT", title: "Root", parent_wombat_id: null },
      { wombat_id: "CHILD", title: "Child", parent_wombat_id: "ROOT" },
    ]);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("sorts siblings alphabetically by title", () => {
    const nodes: FlatNode[] = [
      { wombat_id: "ROOT", title: "Root", parent_wombat_id: null },
      { wombat_id: "C-Z", title: "Zebra", parent_wombat_id: "ROOT" },
      { wombat_id: "C-A", title: "Apple", parent_wombat_id: "ROOT" },
      { wombat_id: "C-M", title: "Mango", parent_wombat_id: "ROOT" },
    ];

    const tree = buildTree(nodes);
    const root = tree[0]!;
    const titles = root.children.map((c) => c.title);
    expect(titles).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("uses wombat_id as tiebreaker when titles are identical", () => {
    const nodes: FlatNode[] = [
      { wombat_id: "ROOT", title: "Root", parent_wombat_id: null },
      { wombat_id: "B-001", title: "Same Title", parent_wombat_id: "ROOT" },
      { wombat_id: "A-001", title: "Same Title", parent_wombat_id: "ROOT" },
    ];

    const tree = buildTree(nodes);
    const root = tree[0]!;
    const ids = root.children.map((c) => c.wombat_id);
    // "A-001" < "B-001" alphabetically.
    expect(ids).toEqual(["A-001", "B-001"]);
  });

  it("builds the FLAT_NODES fixture correctly", () => {
    const tree = buildTree(FLAT_NODES);
    // Two roots: Auth Suite, Billing Suite — alphabetical.
    expect(tree).toHaveLength(2);
    expect(tree[0]!.title).toBe("Auth Suite");
    expect(tree[1]!.title).toBe("Billing Suite");
    // Auth Suite has two children.
    const auth = tree[0]!;
    expect(auth.children).toHaveLength(2);
    // Children sorted: "Login Flow" < "Logout Flow".
    expect(auth.children[0]!.title).toBe("Login Flow");
    expect(auth.children[1]!.title).toBe("Logout Flow");
    // Billing Suite has no children.
    expect(tree[1]!.children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hook tests
// ---------------------------------------------------------------------------

describe("useSuiteTree", () => {
  it("fetches and returns the flat node list", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useSuiteTree(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const nodes = result.current.data!;
    expect(nodes).toHaveLength(FLAT_NODES.length);
    expect(nodes[0]).toMatchObject({ wombat_id: "SUITE-ROOT-A" });
  });

  it("is disabled when slug is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useSuiteTree(""), {
      wrapper: wrapper(qc),
    });
    // isPending (not yet fetched) because enabled=false.
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useSuiteDetail", () => {
  it("fetches a single suite detail", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useSuiteDetail(SLUG, "SUITE-ROOT-A"), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const detail = result.current.data!;
    expect(detail.wombat_id).toBe("SUITE-ROOT-A");
    expect(detail.title).toBe("Auth Suite");
    expect(detail.owner).toBe("@alice");
    expect(detail.cases).toEqual(["TC-001", "TC-002"]);
  });

  it("is disabled when wid is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useSuiteDetail(SLUG, ""), {
      wrapper: wrapper(qc),
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("surfaces a 404 as an error", async () => {
    const qc = makeQC();
    const { result } = renderHook(
      () => useSuiteDetail(SLUG, "SUITE-MISSING"),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The error must come through as a typed ApiError (not a raw Response).
    expect((result.current.error as { code?: string })?.code).toBe("not_found");
  });
});

describe("useResolveSuite", () => {
  it("fetches the resolved case list for a suite", async () => {
    const qc = makeQC();
    const { result } = renderHook(
      () => useResolveSuite(SLUG, "SUITE-ROOT-A"),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const resolved = result.current.data!;
    expect(resolved.wombat_id).toBe("SUITE-ROOT-A");
    expect(resolved.count).toBe(3);
    expect(resolved.cases).toContain("TC-001");
    expect(resolved.cases).toContain("TC-010");
  });

  it("is disabled when slug is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useResolveSuite("", "SUITE-ROOT-A"), {
      wrapper: wrapper(qc),
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });

  it("is disabled when wid is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useResolveSuite(SLUG, ""), {
      wrapper: wrapper(qc),
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(false);
  });
});
