import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { ReviewDetailPage } from "../ReviewDetailPage";
import { SessionContext } from "@/features/auth/AuthProvider";
import type { SessionContextValue } from "@/features/auth/AuthProvider";
import {
  FIXTURE_PROPOSAL_DETAIL,
  FIXTURE_PROPOSAL_ID,
} from "@/tests/fixtures/proposals";
import { FIXTURE_USER } from "@/tests/fixtures/auth";

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
  vi.spyOn(console, "warn").mockImplementation((msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("React Router Future Flag")) return;
    console.warn(msg, ...rest);
  });
});

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function makeSession(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    status: "authed",
    user: FIXTURE_USER,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  };
}

function renderReview(
  proposalId = FIXTURE_PROPOSAL_ID,
  slug = "alpha-project",
  sessionOverrides: Partial<SessionContextValue> = {},
) {
  const qc = makeQC();
  return render(
    <QueryClientProvider client={qc}>
      <SessionContext.Provider value={makeSession(sessionOverrides)}>
        <MemoryRouter initialEntries={[`/p/${slug}/approvals/${proposalId}`]}>
          <Routes>
            <Route
              path="/p/:projectSlug/approvals/:proposalId"
              element={<ReviewDetailPage />}
            />
            <Route
              path="/p/:projectSlug/approvals"
              element={<div data-testid="inbox">Inbox</div>}
            />
            <Route
              path="/p/:projectSlug/approvals/:proposalId/rebase"
              element={<div data-testid="conflict-workspace">Conflict</div>}
            />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("ReviewDetailPage", () => {
  it("renders the proposal title", async () => {
    renderReview();

    await waitFor(() => {
      // The title appears in the <h1> heading element
      const headings = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
      expect(headings.length).toBeGreaterThan(0);
    });
  });

  it("shows Approve and Reject buttons for admin non-author", async () => {
    // FIXTURE_USER is "00000000-0000-0000-0000-000000000001" and
    // FIXTURE_PROPOSAL's author_user_id is also "00000000-0000-0000-0000-000000000001"
    // So we need a different user to see Approve/Reject buttons
    const adminUser = {
      ...FIXTURE_USER,
      id: "99999999-0000-0000-0000-000000000099",
    };

    renderReview(FIXTURE_PROPOSAL_ID, "alpha-project", {
      user: adminUser,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve and publish/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("hides Approve/Reject buttons when user is the author", async () => {
    // FIXTURE_PROPOSAL.author_user_id === FIXTURE_USER.id
    renderReview();

    await waitFor(() => {
      // The proposal title should be visible confirming page loaded
      const headings = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
      expect(headings.length).toBeGreaterThan(0);
    });

    // Approve/Reject should not appear
    expect(screen.queryByRole("button", { name: /approve and publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();

    // Self-review message should appear
    expect(screen.getByText(/cannot approve your own proposal/i)).toBeInTheDocument();
  });

  it("shows 'Rendered' and 'Raw' diff mode toggle buttons", async () => {
    renderReview();

    await waitFor(() => {
      const headings = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
      expect(headings.length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: /rendered/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /raw/i })).toBeInTheDocument();
  });

  it("switching diff mode to Raw does not throw", async () => {
    renderReview();

    await waitFor(() => {
      const headings = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
      expect(headings.length).toBeGreaterThan(0);
    });

    const rawBtn = screen.getByRole("button", { name: /raw/i });
    fireEvent.click(rawBtn);

    // Should still render without crashing — title still present somewhere in the DOM
    const matches = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("approve button click on 409 stale_base_revision navigates to conflict workspace", async () => {
    const adminUser = {
      ...FIXTURE_USER,
      id: "99999999-0000-0000-0000-000000000099",
    };

    server.use(
      http.post("*/api/projects/:slug/proposals/:id/approve", () => {
        return HttpResponse.json(
          {
            detail: {
              code: "stale_base_revision",
              current_sha: "conflict-sha-xyz",
            },
          },
          { status: 409 },
        );
      }),
    );

    renderReview(FIXTURE_PROPOSAL_ID, "alpha-project", { user: adminUser });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve and publish/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /approve and publish/i }));

    // After the 409, the component should navigate to the conflict workspace
    await waitFor(() => {
      expect(screen.queryByTestId("conflict-workspace")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
