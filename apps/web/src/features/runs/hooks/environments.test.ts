import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { runKeys } from "../queryKeys";
import {
  useEnvironments,
  useCreateEnvironment,
  useDeleteEnvironment,
  type Environment,
} from "./environments";
import { UnauthorizedRunActionError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = "demo";

const ENV_1: Environment = {
  id: "env-001",
  project_id: "proj-aaa",
  name: "staging",
  created_at: "2026-04-22T10:00:00Z",
};

const ENV_2: Environment = {
  id: "env-002",
  project_id: "proj-aaa",
  name: "production",
  created_at: "2026-04-22T10:01:00Z",
};

const FIXTURE_ENV_LIST = { data: [ENV_1, ENV_2] };

// ---------------------------------------------------------------------------
// MSW default handlers (registered before each test)
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");

  // Register default happy-path handlers for this test suite.
  server.use(
    http.get("*/api/projects/:project_slug/environments", () => {
      return HttpResponse.json(FIXTURE_ENV_LIST);
    }),

    http.post("*/api/projects/:project_slug/environments", async ({ request }) => {
      const body = (await request.json()) as { name: string };
      const created: Environment = {
        id: "env-new",
        project_id: "proj-aaa",
        name: body.name,
        created_at: "2026-04-22T11:00:00Z",
      };
      return HttpResponse.json({ data: created }, { status: 201 });
    }),

    http.delete("*/api/projects/:project_slug/environments/:env_id", () => {
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

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
    return (
      QueryClientProvider({ client: qc, children })
    );
  };
}

// ---------------------------------------------------------------------------
// useEnvironments
// ---------------------------------------------------------------------------

describe("useEnvironments", () => {
  it("fetches and returns the environment list", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useEnvironments(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.id).toBe("env-001");
    expect(result.current.data?.[1]?.name).toBe("production");
  });

  it("is disabled when projectSlug is empty", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useEnvironments(""), {
      wrapper: wrapper(qc),
    });

    // Should stay in idle/pending state, never fire
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("uses the environments namespace key (not runs)", async () => {
    const qc = makeQC();
    renderHook(() => useEnvironments(SLUG), { wrapper: wrapper(qc) });

    const key = runKeys.environments(SLUG);
    expect(key[0]).toBe("environments");
    expect(key[1]).toBe(SLUG);
  });

  it("surfaces ApiError on non-2xx response", async () => {
    server.use(
      http.get("*/api/projects/:project_slug/environments", () =>
        HttpResponse.json(
          { error: { code: "not_found", message: "Project not found.", field: null, hint: null } },
          { status: 404 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useEnvironments(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error as unknown as { status: number; code: string };
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// useCreateEnvironment
// ---------------------------------------------------------------------------

describe("useCreateEnvironment", () => {
  it("creates an environment and returns the new record", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useCreateEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let created: Environment | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ name: "qa" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(created?.name).toBe("qa");
    expect(created?.id).toBe("env-new");
  });

  it("invalidates the environments list on success", async () => {
    const qc = makeQC();

    // Pre-populate the cache so we can check invalidation
    qc.setQueryData(runKeys.environments(SLUG), [ENV_1, ENV_2]);

    const { result } = renderHook(() => useCreateEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "perf" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const state = qc.getQueryState(runKeys.environments(SLUG));
    expect(state?.isInvalidated).toBe(true);
  });

  it("403 surfaces as an error with status 403", async () => {
    server.use(
      http.post("*/api/projects/:project_slug/environments", () =>
        HttpResponse.json(
          { error: { code: "unauthorized", message: "forbidden", field: null, hint: null } },
          { status: 403 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCreateEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "x" });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeDefined();
    expect((caughtError as { status: number }).status).toBe(403);
  });

  it("403 with unauthorized_run_action code surfaces UnauthorizedRunActionError", async () => {
    server.use(
      http.post("*/api/projects/:project_slug/environments", () =>
        HttpResponse.json(
          {
            error: {
              code: "unauthorized_run_action",
              message: "forbidden",
              field: null,
              hint: null,
            },
          },
          { status: 403 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCreateEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "x" });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(UnauthorizedRunActionError);
    expect((caughtError as UnauthorizedRunActionError).status).toBe(403);
  });

  it("409 duplicate name surfaces ApiError", async () => {
    server.use(
      http.post("*/api/projects/:project_slug/environments", () =>
        HttpResponse.json(
          {
            error: {
              code: "environment_already_exists",
              message: "An environment with that name already exists.",
              field: "name",
              hint: null,
            },
          },
          { status: 409 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useCreateEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "staging" });
      } catch (e) {
        caughtError = e;
      }
    });

    expect((caughtError as { status: number }).status).toBe(409);
    expect((caughtError as { code: string }).code).toBe("environment_already_exists");
  });
});

// ---------------------------------------------------------------------------
// useDeleteEnvironment
// ---------------------------------------------------------------------------

describe("useDeleteEnvironment", () => {
  it("deletes an environment (204) without error", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useDeleteEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync("env-001");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("invalidates the environments list on successful delete", async () => {
    const qc = makeQC();

    qc.setQueryData(runKeys.environments(SLUG), [ENV_1, ENV_2]);

    const { result } = renderHook(() => useDeleteEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync("env-001");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const state = qc.getQueryState(runKeys.environments(SLUG));
    expect(state?.isInvalidated).toBe(true);
  });

  it("403 surfaces error with status 403", async () => {
    server.use(
      http.delete("*/api/projects/:project_slug/environments/:env_id", () =>
        HttpResponse.json(
          { error: { code: "unauthorized", message: "forbidden", field: null, hint: null } },
          { status: 403 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useDeleteEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync("env-001");
      } catch (e) {
        caughtError = e;
      }
    });

    expect((caughtError as { status: number }).status).toBe(403);
  });

  it("404 surfaces error with status 404", async () => {
    server.use(
      http.delete("*/api/projects/:project_slug/environments/:env_id", () =>
        HttpResponse.json(
          {
            error: {
              code: "environment_not_found",
              message: "Environment not found.",
              field: null,
              hint: null,
            },
          },
          { status: 404 },
        ),
      ),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useDeleteEnvironment(SLUG), {
      wrapper: wrapper(qc),
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync("env-does-not-exist");
      } catch (e) {
        caughtError = e;
      }
    });

    expect((caughtError as { status: number }).status).toBe(404);
    expect((caughtError as { code: string }).code).toBe("environment_not_found");
  });
});
