/**
 * MSW-backed tests for plans hooks.
 *
 * Each test spins up its own QueryClient with retry: false so that error paths
 * do not retry and tests stay fast.
 *
 * Handlers for /api/projects/:slug/plans/* are registered inline via
 * server.use() so they override the global MSW handlers for the duration of
 * each test. server.resetHandlers() in the global afterEach (setup.ts) cleans
 * them up automatically.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import {
  usePlansList,
  usePlanDetail,
  useResolvePlan,
  useStartRunDraft,
  useClonePlan,
  planKeys,
  type PlanSummary,
  type PlanDetail,
  type ResolvedPlan,
  type StartRunDraft,
  type ClonePlanResponse,
} from "./hooks";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SLUG = "alpha-project";
const PLAN_WID = "PLAN-001";
const CLONE_WID = "PLAN-002";

const FIXTURE_PLAN_SUMMARY: PlanSummary = {
  wombat_id: PLAN_WID,
  title: "Smoke Suite Plan",
  kind: "plan",
  tags: ["smoke", "regression"],
  description: "Nightly smoke test plan",
  created_at: "2026-04-22T00:00:00Z",
  updated_at: "2026-04-22T00:00:00Z",
};

const FIXTURE_PLAN_DETAIL: PlanDetail = {
  ...FIXTURE_PLAN_SUMMARY,
  body: {
    suite_refs: ["SUITE-001"],
    explicit_cases: { add: ["TC-001", "TC-002"], remove: [] },
    environments: ["env-staging"],
    assignees: ["user-alice"],
  },
  source_path: "plans/PLAN-001.md",
  project_id: "project-uuid-alpha",
};

const FIXTURE_RESOLVED_PLAN: ResolvedPlan = {
  plan_wombat_id: PLAN_WID,
  title: "Smoke Suite Plan",
  resolved_cases: [
    {
      wombat_id: "TC-001",
      title: "Login happy path",
      source_path: "testcases/TC-001.md",
      suite_path: [],
    },
    {
      wombat_id: "TC-002",
      title: "Logout",
      source_path: "testcases/TC-002.md",
      suite_path: [],
    },
  ],
  total: 2,
  resolved_at: "2026-04-22T01:00:00Z",
};

const FIXTURE_START_RUN_DRAFT: StartRunDraft = {
  plan_wombat_id: PLAN_WID,
  title: "Smoke Suite Plan",
  environment_id: "env-staging",
  assignee_user_ids: ["user-alice"],
  assignee_token_ids: [],
  resolved_case_ids: ["TC-001", "TC-002"],
  resolved_case_count: 2,
};

const FIXTURE_CLONE_RESPONSE: ClonePlanResponse = {
  proposal_id: "prop-clone-001",
  new_wombat_id: CLONE_WID,
  title: "Smoke Suite Plan (copy)",
  status: "open",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

// Provide tokens so the auth middleware doesn't redirect.
beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
});

// ---------------------------------------------------------------------------
// Register default handlers for plan endpoints
// (These are overridden per-test where needed)
// ---------------------------------------------------------------------------

beforeEach(() => {
  server.use(
    http.get("*/api/projects/:project_slug/plans", () => {
      return HttpResponse.json({ data: [FIXTURE_PLAN_SUMMARY] });
    }),

    http.get("*/api/projects/:project_slug/plans/:wombat_id", ({ params }) => {
      const wid = params["wombat_id"] as string;
      if (wid !== PLAN_WID) {
        return HttpResponse.json(
          {
            error: {
              code: "not_found",
              message: `Plan '${wid}' not found.`,
              field: null,
              hint: null,
            },
          },
          { status: 404 },
        );
      }
      return HttpResponse.json(FIXTURE_PLAN_DETAIL);
    }),

    http.get(
      "*/api/projects/:project_slug/plans/:wombat_id/resolve",
      ({ params }) => {
        const wid = params["wombat_id"] as string;
        if (wid !== PLAN_WID) {
          return HttpResponse.json(
            {
              error: {
                code: "not_found",
                message: `Plan '${wid}' not found.`,
                field: null,
                hint: null,
              },
            },
            { status: 404 },
          );
        }
        return HttpResponse.json(FIXTURE_RESOLVED_PLAN);
      },
    ),

    http.post(
      "*/api/projects/:project_slug/plans/:wombat_id/start-run",
      ({ params }) => {
        const wid = params["wombat_id"] as string;
        if (wid !== PLAN_WID) {
          return HttpResponse.json(
            {
              error: {
                code: "not_found",
                message: `Plan '${wid}' not found.`,
                field: null,
                hint: null,
              },
            },
            { status: 404 },
          );
        }
        return HttpResponse.json(FIXTURE_START_RUN_DRAFT);
      },
    ),

    http.post(
      "*/api/projects/:project_slug/plans/:wombat_id/clone",
      ({ params }) => {
        const wid = params["wombat_id"] as string;
        if (wid !== PLAN_WID) {
          return HttpResponse.json(
            {
              error: {
                code: "not_found",
                message: `Plan '${wid}' not found.`,
                field: null,
                hint: null,
              },
            },
            { status: 404 },
          );
        }
        return HttpResponse.json(FIXTURE_CLONE_RESPONSE, { status: 201 });
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// usePlansList
// ---------------------------------------------------------------------------

describe("usePlansList", () => {
  it("fetches and returns the plans array", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => usePlansList(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const plans = result.current.data;
    expect(Array.isArray(plans)).toBe(true);
    expect(plans).toHaveLength(1);
    expect(plans?.[0]?.wombat_id).toBe(PLAN_WID);
    expect(plans?.[0]?.kind).toBe("plan");
  });

  it("supports tag and q filter params", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get("*/api/projects/:project_slug/plans", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(
      () => usePlansList(SLUG, { tag: ["smoke"], q: "login" }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);
    expect(url.searchParams.get("q")).toBe("login");
    // MSW serialises repeated params as tag=smoke
    expect(url.searchParams.getAll("tag")).toContain("smoke");
  });

  it("returns empty array when backend returns no data", async () => {
    server.use(
      http.get("*/api/projects/:project_slug/plans", () => {
        return HttpResponse.json({ data: [] });
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => usePlansList(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// usePlanDetail
// ---------------------------------------------------------------------------

describe("usePlanDetail", () => {
  it("fetches and returns a single plan detail", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => usePlanDetail(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const plan = result.current.data;
    expect(plan?.wombat_id).toBe(PLAN_WID);
    expect(plan?.title).toBe("Smoke Suite Plan");
    expect(plan?.body.suite_refs).toEqual(["SUITE-001"]);
    expect(plan?.body.explicit_cases).toEqual({
      add: ["TC-001", "TC-002"],
      remove: [],
    });
  });

  it("is disabled when wid is empty", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => usePlanDetail(SLUG, ""), {
      wrapper: wrapper(qc),
    });

    // Should remain in loading state with fetchStatus idle (disabled)
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useResolvePlan
// ---------------------------------------------------------------------------

describe("useResolvePlan", () => {
  it("fetches resolved cases for a plan", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useResolvePlan(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const resolved = result.current.data;
    expect(resolved?.plan_wombat_id).toBe(PLAN_WID);
    expect(resolved?.total).toBe(2);
    expect(resolved?.resolved_cases).toHaveLength(2);
    expect(resolved?.resolved_cases[0]?.wombat_id).toBe("TC-001");
  });

  it("resolve key is nested under detail key (prefix hierarchy)", () => {
    const detail = planKeys.detail(SLUG, PLAN_WID);
    const resolve = planKeys.resolve(SLUG, PLAN_WID);
    // resolve must start with all elements of detail
    expect(resolve.slice(0, detail.length)).toEqual([...detail]);
  });
});

// ---------------------------------------------------------------------------
// useStartRunDraft — mutation
// ---------------------------------------------------------------------------

describe("useStartRunDraft", () => {
  it("is a mutation hook — returns mutate / mutateAsync", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useStartRunDraft(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    expect(typeof result.current.mutate).toBe("function");
    expect(typeof result.current.mutateAsync).toBe("function");
    // Initial state — not yet called
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("returns StartRunDraft shape when invoked", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useStartRunDraft(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    let draft: StartRunDraft | undefined;
    await act(async () => {
      draft = await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(draft?.plan_wombat_id).toBe(PLAN_WID);
    expect(draft?.resolved_case_count).toBe(2);
    expect(draft?.environment_id).toBe("env-staging");
    expect(Array.isArray(draft?.resolved_case_ids)).toBe(true);
  });

  it("does not write to the query cache (no stale draft risk)", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useStartRunDraft(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    // The result is not stored under any plan query key
    const cached = qc.getQueryData(planKeys.detail(SLUG, PLAN_WID));
    expect(cached).toBeUndefined();
    const resolvedCached = qc.getQueryData(planKeys.resolve(SLUG, PLAN_WID));
    expect(resolvedCached).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useClonePlan
// ---------------------------------------------------------------------------

describe("useClonePlan", () => {
  it("posts the clone request and returns ClonePlanResponse", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useClonePlan(SLUG), {
      wrapper: wrapper(qc),
    });

    let cloneResult: ClonePlanResponse | undefined;
    await act(async () => {
      cloneResult = await result.current.mutateAsync({
        wombat_id: PLAN_WID,
        new_wombat_id: CLONE_WID,
        title: "Smoke Suite Plan (copy)",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cloneResult?.proposal_id).toBe("prop-clone-001");
    expect(cloneResult?.new_wombat_id).toBe(CLONE_WID);
    expect(cloneResult?.status).toBe("open");
  });

  it("passes new_wombat_id and optional title to the request body", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    server.use(
      http.post(
        "*/api/projects/:project_slug/plans/:wombat_id/clone",
        async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(FIXTURE_CLONE_RESPONSE, { status: 201 });
        },
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useClonePlan(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        wombat_id: PLAN_WID,
        new_wombat_id: CLONE_WID,
        title: "My Custom Clone Title",
      });
    });

    expect(capturedBody?.["new_wombat_id"]).toBe(CLONE_WID);
    expect(capturedBody?.["title"]).toBe("My Custom Clone Title");
  });

  it("omits title from body when not provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    server.use(
      http.post(
        "*/api/projects/:project_slug/plans/:wombat_id/clone",
        async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(FIXTURE_CLONE_RESPONSE, { status: 201 });
        },
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useClonePlan(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        wombat_id: PLAN_WID,
        new_wombat_id: CLONE_WID,
      });
    });

    expect(capturedBody?.["new_wombat_id"]).toBe(CLONE_WID);
    expect("title" in (capturedBody ?? {})).toBe(false);
  });

  it("invalidates planKeys.all(slug) on success", async () => {
    const qc = makeQC();

    // Pre-fill the list cache so we can observe invalidation
    qc.setQueryData(planKeys.list(SLUG, {}), [FIXTURE_PLAN_SUMMARY]);

    const { result } = renderHook(() => useClonePlan(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        wombat_id: PLAN_WID,
        new_wombat_id: CLONE_WID,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const listState = qc.getQueryState(planKeys.list(SLUG, {}));
    expect(listState?.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe("error paths", () => {
  it("usePlanDetail — 403 surfaces as a thrown error", async () => {
    server.use(
      http.get("*/api/projects/:project_slug/plans/:wombat_id", () => {
        return HttpResponse.json(
          {
            error: {
              code: "forbidden",
              message: "You do not have access to this project.",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => usePlanDetail(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const err = result.current.error;
    expect(err).toBeDefined();
    // The client wraps this as an ApiError with status 403
    expect((err as { status?: number }).status).toBe(403);
  });

  it("usePlansList — 403 surfaces as a thrown error", async () => {
    server.use(
      http.get("*/api/projects/:project_slug/plans", () => {
        return HttpResponse.json(
          {
            error: {
              code: "forbidden",
              message: "Forbidden.",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => usePlansList(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as { status?: number }).status).toBe(403);
  });

  it("useStartRunDraft — error propagates through the mutation", async () => {
    server.use(
      http.post(
        "*/api/projects/:project_slug/plans/:wombat_id/start-run",
        () => {
          return HttpResponse.json(
            {
              error: {
                code: "forbidden",
                message: "Not allowed.",
                field: null,
                hint: null,
              },
            },
            { status: 403 },
          );
        },
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useStartRunDraft(SLUG, PLAN_WID), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as { status?: number }).status).toBe(403);
  });

  it("useClonePlan — error propagates through the mutation", async () => {
    server.use(
      http.post(
        "*/api/projects/:project_slug/plans/:wombat_id/clone",
        () => {
          return HttpResponse.json(
            {
              error: {
                code: "forbidden",
                message: "Forbidden.",
                field: null,
                hint: null,
              },
            },
            { status: 403 },
          );
        },
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useClonePlan(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          wombat_id: PLAN_WID,
          new_wombat_id: CLONE_WID,
        }),
      ).rejects.toThrow();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { status?: number }).status).toBe(403);
  });
});
