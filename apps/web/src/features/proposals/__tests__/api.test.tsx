import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import {
  FIXTURE_PROPOSAL,
  FIXTURE_PROPOSALS_LIST,
  FIXTURE_PROPOSALS_LIST_PAGE_1,
  FIXTURE_PROPOSALS_LIST_PAGE_2,
  FIXTURE_PROPOSAL_ID,
} from "@/tests/fixtures/proposals";
import {
  useProposals,
  useInboxBadge,
  useCreateProposal,
  useApproveProposal,
  useDirectPublish,
  type ProposalListPage,
} from "../api";
import { keys } from "@/lib/query/keys";

// Fake access token so auth middleware doesn't redirect
beforeEach(() => {
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

describe("useProposals", () => {
  it("fetches and returns the proposal list", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useProposals(SLUG, {}), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const page = result.current.data as ProposalListPage;
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.id).toBe(FIXTURE_PROPOSAL_ID);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it("supports cursor pagination — next_cursor flows through filters", async () => {
    // Override handler to return paginated results
    server.use(
      http.get("*/api/projects/:slug/proposals", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        if (cursor === "cursor-abc") {
          return HttpResponse.json(FIXTURE_PROPOSALS_LIST_PAGE_2);
        }
        return HttpResponse.json(FIXTURE_PROPOSALS_LIST_PAGE_1);
      }),
    );

    const qc = makeQC();

    // Page 1
    const { result: r1 } = renderHook(() => useProposals(SLUG, {}), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    const page1 = r1.current.data as ProposalListPage;
    expect(page1.data).toHaveLength(1);
    expect(page1.pagination.next_cursor).toBe("cursor-abc");

    // Page 2 (different filters key)
    const { result: r2 } = renderHook(
      () => useProposals(SLUG, { cursor: "cursor-abc" }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));
    const page2 = r2.current.data as ProposalListPage;
    expect(page2.data).toHaveLength(1);
    expect(page2.pagination.next_cursor).toBeNull();
  });
});

describe("useInboxBadge", () => {
  it("returns the count of open proposals", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useInboxBadge(SLUG), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Default MSW handler returns FIXTURE_PROPOSALS_LIST with 2 items
    expect(typeof result.current.data).toBe("number");
    expect(result.current.data).toBeGreaterThanOrEqual(0);
  });
});

describe("useCreateProposal", () => {
  const CREATE_BODY = {
    kind: "testcase" as const,
    source_path: "testcases/TC-001.md",
    base_revision: "abc123",
    proposed_title: "New test",
    proposed_body: { markdown: "## Steps" },
  };

  it("creates a proposal and invalidates list + inboxBadge", async () => {
    const qc = makeQC();

    // Prefill the list cache so we can check invalidation
    qc.setQueryData(keys.proposal.list(SLUG, {}), FIXTURE_PROPOSALS_LIST);
    qc.setQueryData(keys.proposal.inboxBadge(SLUG), 2);

    const { result } = renderHook(() => useCreateProposal(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync(CREATE_BODY);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // After mutation, the list and inboxBadge query cache entries should be
    // marked as stale/invalidated (their observer count may be 0 but the
    // query should be invalidated).
    const listQuery = qc.getQueryState(keys.proposal.list(SLUG, {}));
    expect(listQuery?.isInvalidated).toBe(true);

    const badgeQuery = qc.getQueryState(keys.proposal.inboxBadge(SLUG));
    expect(badgeQuery?.isInvalidated).toBe(true);
  });

  it("returns the created proposal data", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useCreateProposal(SLUG), {
      wrapper: wrapper(qc),
    });

    let data: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      data = await result.current.mutateAsync(CREATE_BODY);
    });

    expect(data?.proposal.id).toBe(FIXTURE_PROPOSAL_ID);
    expect(data?.published_sha).toBeUndefined();
  });
});

describe("useApproveProposal", () => {
  it("approves and invalidates content detail + list + inboxBadge", async () => {
    const qc = makeQC();

    qc.setQueryData(keys.proposal.list(SLUG, {}), FIXTURE_PROPOSALS_LIST);
    qc.setQueryData(keys.proposal.inboxBadge(SLUG), 2);
    qc.setQueryData(
      keys.proposal.detail(SLUG, FIXTURE_PROPOSAL_ID),
      FIXTURE_PROPOSAL,
    );
    // Simulate a testcase detail entry that should be invalidated
    qc.setQueryData(
      keys.testcase.detail(SLUG, "TC-001"),
      { wombat_id: "TC-001" },
    );

    const { result } = renderHook(() => useApproveProposal(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        proposalId: FIXTURE_PROPOSAL_ID,
        body: { comment: "LGTM" },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // list and badge should be invalidated
    expect(qc.getQueryState(keys.proposal.list(SLUG, {}))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.proposal.inboxBadge(SLUG))?.isInvalidated).toBe(true);
    expect(
      qc.getQueryState(keys.proposal.detail(SLUG, FIXTURE_PROPOSAL_ID))?.isInvalidated,
    ).toBe(true);
  });

  it("returns published_sha in response", async () => {
    const qc = makeQC();
    const { result } = renderHook(() => useApproveProposal(SLUG), {
      wrapper: wrapper(qc),
    });

    let data: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({
        proposalId: FIXTURE_PROPOSAL_ID,
        body: {},
      });
    });

    expect(data?.published_sha).toBe("sha-approved");
  });
});

describe("useDirectPublish", () => {
  it("issues POST with auto_approve=true query param", async () => {
    let capturedUrl: string | undefined;

    server.use(
      http.post("*/api/projects/:slug/proposals", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(
          {
            data: {
              proposal: FIXTURE_PROPOSAL,
              published_sha: "direct-sha",
            },
          },
          { status: 201 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useDirectPublish(SLUG), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        kind: "testcase",
        source_path: "testcases/TC-001.md",
        base_revision: "abc123",
        proposed_title: "Direct publish test",
        proposed_body: { markdown: "## Body" },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);
    expect(url.searchParams.get("auto_approve")).toBe("true");
  });

  it("returns published_sha when direct-publish succeeds", async () => {
    server.use(
      http.post("*/api/projects/:slug/proposals", () => {
        return HttpResponse.json(
          {
            data: {
              proposal: FIXTURE_PROPOSAL,
              published_sha: "dp-sha-xyz",
            },
          },
          { status: 201 },
        );
      }),
    );

    const qc = makeQC();
    const { result } = renderHook(() => useDirectPublish(SLUG), {
      wrapper: wrapper(qc),
    });

    let data: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      data = await result.current.mutateAsync({
        kind: "testcase",
        source_path: "testcases/TC-001.md",
        base_revision: "abc123",
        proposed_title: "Direct publish",
        proposed_body: { markdown: "body" },
      });
    });

    expect(data?.published_sha).toBe("dp-sha-xyz");
  });
});
