/**
 * Unit tests for dashboard widget hooks.
 *
 * MSW handlers are defined inline (via server.use) so they don't pollute the
 * global handler list and are automatically reset after each test via the
 * afterEach in tests/setup.ts.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import React from "react";
import { server } from "@/tests/msw/server";
import { useWidgetMeta, useWidget } from "./hooks";
import type { WidgetMeta, Filters, Scope } from "./hooks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_SLUG = "acme";
const PROJECT_UUID = "proj-uuid-1234";
const PLAN_WOMBAT_ID = "WB-PLAN-0001";

const FIXTURE_WIDGET_META: WidgetMeta[] = [
  {
    slug: "passfail_trend",
    title: "Pass / fail trend",
    scope_kinds: ["project", "plan"],
    requires: [],
  },
  {
    slug: "recent_runs",
    title: "Recent runs",
    scope_kinds: ["project", "plan"],
    requires: [],
  },
  {
    slug: "top_failing_cases",
    title: "Top failing cases",
    scope_kinds: ["project", "plan"],
    requires: [],
  },
  {
    slug: "review_backlog",
    title: "Review backlog",
    scope_kinds: ["project"],
    requires: [],
  },
  {
    slug: "release_readiness",
    title: "Release readiness",
    scope_kinds: ["project"],
    requires: ["plan_id"],
  },
];

const FIXTURE_PASSFAIL_TREND = {
  points: [
    { date: "2026-04-15", pass: 10, fail: 2, skip: 1 },
    { date: "2026-04-16", pass: 12, fail: 1, skip: 0 },
  ],
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

// ---------------------------------------------------------------------------
// Shared MSW setup: register the two widget endpoints for all tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  server.use(
    http.get(`*/api/projects/${PROJECT_SLUG}/dashboards/widgets`, () => {
      return HttpResponse.json({ widgets: FIXTURE_WIDGET_META });
    }),

    http.get(`*/api/projects/${PROJECT_SLUG}/dashboards/widget/:widget_slug`, ({ params, request }) => {
      const widgetSlug = params["widget_slug"] as string;
      const url = new URL(request.url);
      const scope = url.searchParams.get("scope");
      const scopeId = url.searchParams.get("scope_id");
      const planId = url.searchParams.get("plan_id");

      if (widgetSlug === "release_readiness" && scope === "project" && !planId) {
        return HttpResponse.json(
          {
            error: {
              code: "widget_missing_filter",
              message: "plan_id is required for release_readiness on project scope.",
              field: "plan_id",
              hint: null,
            },
          },
          { status: 400 },
        );
      }

      if (widgetSlug === "passfail_trend") {
        return HttpResponse.json({
          ...FIXTURE_PASSFAIL_TREND,
          scope,
          scope_id: scopeId,
        });
      }

      return HttpResponse.json({ slug: widgetSlug, scope, scope_id: scopeId, data: [] });
    }),
  );
});

// ---------------------------------------------------------------------------
// Tests: useWidgetMeta
// ---------------------------------------------------------------------------

describe("useWidgetMeta", () => {
  it("returns the widgets array from the API", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useWidgetMeta(PROJECT_SLUG), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(FIXTURE_WIDGET_META.length);
    expect(result.current.data?.[0]).toMatchObject({
      slug: "passfail_trend",
      title: "Pass / fail trend",
      scope_kinds: ["project", "plan"],
      requires: [],
    });
  });

  it("includes release_readiness with requires=[plan_id]", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useWidgetMeta(PROJECT_SLUG), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const releaseReadiness = result.current.data?.find((w) => w.slug === "release_readiness");
    expect(releaseReadiness).toBeDefined();
    expect(releaseReadiness?.requires).toContain("plan_id");
  });

  it("is not enabled when slug is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useWidgetMeta(""), {
      wrapper: makeWrapper(qc),
    });

    // Should not fire a fetch — stays in pending state with no data
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: useWidget — project scope
// ---------------------------------------------------------------------------

describe("useWidget (project scope)", () => {
  it("returns widget data for passfail_trend on project scope", async () => {
    const qc = makeQC();
    const scope: Scope = { kind: "project", projectId: PROJECT_UUID };

    const { result } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, {}),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      points: FIXTURE_PASSFAIL_TREND.points,
      scope: "project",
      scope_id: PROJECT_UUID,
    });
  });

  it("sends the correct scope_id for a project scope", async () => {
    const captured: string[] = [];

    server.use(
      http.get(`*/api/projects/${PROJECT_SLUG}/dashboards/widget/passfail_trend`, ({ request }) => {
        const url = new URL(request.url);
        captured.push(url.searchParams.get("scope_id") ?? "");
        return HttpResponse.json(FIXTURE_PASSFAIL_TREND);
      }),
    );

    const qc = makeQC();
    const scope: Scope = { kind: "project", projectId: PROJECT_UUID };

    const { result } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, {}),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured[0]).toBe(PROJECT_UUID);
  });
});

// ---------------------------------------------------------------------------
// Tests: useWidget — plan scope
// ---------------------------------------------------------------------------

describe("useWidget (plan scope)", () => {
  it("sends plan wombat_id as scope_id for plan scope", async () => {
    const captured: { scope: string | null; scope_id: string | null } = { scope: null, scope_id: null };

    server.use(
      http.get(`*/api/projects/${PROJECT_SLUG}/dashboards/widget/passfail_trend`, ({ request }) => {
        const url = new URL(request.url);
        captured.scope = url.searchParams.get("scope");
        captured.scope_id = url.searchParams.get("scope_id");
        return HttpResponse.json(FIXTURE_PASSFAIL_TREND);
      }),
    );

    const qc = makeQC();
    const scope: Scope = { kind: "plan", planWombatId: PLAN_WOMBAT_ID };

    const { result } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, {}),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured.scope).toBe("plan");
    expect(captured.scope_id).toBe(PLAN_WOMBAT_ID);
  });
});

// ---------------------------------------------------------------------------
// Tests: filter changes produce distinct cache entries
// ---------------------------------------------------------------------------

describe("useWidget — filter changes produce distinct cache entries", () => {
  it("changing window filter creates a new cache entry", async () => {
    const qc = makeQC();
    const scope: Scope = { kind: "project", projectId: PROJECT_UUID };

    // Render with 7d window
    const { result: r1 } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, { window: "7d" }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    // Render with 30d window in the SAME QueryClient
    const { result: r2 } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, { window: "30d" }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // Both entries should be in the cache under different keys
    const allEntries = qc.getQueryCache().getAll();
    const widgetEntries = allEntries.filter(
      (entry) =>
        Array.isArray(entry.queryKey) &&
        entry.queryKey[0] === "dashboards" &&
        entry.queryKey[1] === PROJECT_SLUG &&
        entry.queryKey[2] === "passfail_trend",
    );

    // One entry for the 7d key, one for the 30d key
    expect(widgetEntries.length).toBeGreaterThanOrEqual(2);
  });

  it("changing env_id filter creates a distinct cache entry", async () => {
    const qc = makeQC();
    const scope: Scope = { kind: "project", projectId: PROJECT_UUID };
    const baseFilters: Filters = { window: "30d" };

    const { result: r1 } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, baseFilters),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    const { result: r2 } = renderHook(
      () => useWidget(PROJECT_SLUG, "passfail_trend", scope, { ...baseFilters, env_id: "env-uuid-abc" }),
      { wrapper: makeWrapper(qc) },
    );
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    const allEntries = qc.getQueryCache().getAll();
    const widgetEntries = allEntries.filter(
      (entry) =>
        Array.isArray(entry.queryKey) &&
        entry.queryKey[0] === "dashboards" &&
        entry.queryKey[2] === "passfail_trend",
    );

    expect(widgetEntries.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: release_readiness without plan_id returns 400 as thrown error
// ---------------------------------------------------------------------------

describe("useWidget — release_readiness without plan_id", () => {
  it("surfaces server 400 as a thrown error when plan_id is missing", async () => {
    const qc = makeQC();
    const scope: Scope = { kind: "project", projectId: PROJECT_UUID };

    // No plan_id — server returns 400
    const { result } = renderHook(
      () => useWidget(PROJECT_SLUG, "release_readiness", scope, {}),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    // The error should have the API error code or message
    const err = result.current.error as Error;
    expect(err).toBeDefined();
    // Once Task 36 lands, this will be an instanceof WidgetMissingFilterError.
    // For now we just verify the message from the API envelope is surfaced.
    // TODO(SP3.4 Task 36): assert instanceof WidgetMissingFilterError
    expect(err.message).toMatch(/plan_id/i);
  });
});
