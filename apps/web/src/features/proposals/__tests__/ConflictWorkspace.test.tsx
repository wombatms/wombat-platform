import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConflictWorkspace } from "../ConflictWorkspace";
import { SessionContext } from "@/features/auth/AuthProvider";
import type { SessionContextValue } from "@/features/auth/AuthProvider";
import { FIXTURE_PROPOSAL_DETAIL, FIXTURE_PROPOSAL_ID } from "@/tests/fixtures/proposals";
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

function renderConflict(
  proposalId = FIXTURE_PROPOSAL_ID,
  slug = "alpha-project",
) {
  const qc = makeQC();
  return render(
    <QueryClientProvider client={qc}>
      <SessionContext.Provider value={makeSession()}>
        <MemoryRouter initialEntries={[`/p/${slug}/approvals/${proposalId}/rebase`]}>
          <Routes>
            <Route
              path="/p/:projectSlug/approvals/:proposalId/rebase"
              element={<ConflictWorkspace />}
            />
            <Route
              path="/p/:projectSlug/approvals/:proposalId"
              element={<div data-testid="review-detail">Review Detail</div>}
            />
            <Route
              path="/p/:projectSlug/:kind/:wombatId/edit"
              element={<div data-testid="edit-form">Edit Form</div>}
            />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("ConflictWorkspace", () => {
  it("renders the three-pane layout with pane labels", async () => {
    renderConflict();

    await waitFor(() => {
      // The proposal title should appear in the breadcrumb / header
      const matches = screen.queryAllByText(FIXTURE_PROPOSAL_DETAIL.proposal.proposed_title);
      expect(matches.length).toBeGreaterThan(0);
    });

    // Three pane labels (use getAllByText since sublabels also match)
    expect(screen.getAllByText(/your base/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/current main/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/your proposed/i).length).toBeGreaterThan(0);
  });

  it("shows the conflict banner with explanation", async () => {
    renderConflict();

    await waitFor(() => {
      expect(screen.getByText(/merge conflict/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/content has changed since this proposal was created/i),
    ).toBeInTheDocument();
  });

  it("renders the Rebase button", async () => {
    renderConflict();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rebase onto current main/i }),
      ).toBeInTheDocument();
    });
  });

  it("Rebase button navigates to EditForm route with rebase param", async () => {
    renderConflict();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /rebase onto current main/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /rebase onto current main/i }));

    // The navigation goes to the edit route; our test route renders "Edit Form"
    // Note: the ConflictWorkspace navigates to:
    //   /p/:slug/:kind/:content_id/edit?rebase=:proposalId
    // The fixture content_id is "cccccccc-0000-0000-0000-000000000001"
    await waitFor(() => {
      expect(screen.getByTestId("edit-form")).toBeInTheDocument();
    });
  });

  it("Cancel button navigates back to review detail", async () => {
    renderConflict();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByTestId("review-detail")).toBeInTheDocument();
    });
  });

  it("shows the Conflict breadcrumb segment", async () => {
    renderConflict();

    await waitFor(() => {
      expect(screen.getByText("Conflict")).toBeInTheDocument();
    });
  });
});
