import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { EditForm } from "../EditForm";
import { SessionContext } from "@/features/auth/AuthProvider";
import type { SessionContextValue } from "@/features/auth/AuthProvider";
import { FIXTURE_USER } from "@/tests/fixtures/auth";
import { FIXTURE_TESTCASE_1 } from "@/tests/fixtures/testcases";

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

function renderNewForm(slug = "alpha-project", sessionOverrides: Partial<SessionContextValue> = {}) {
  const qc = makeQC();
  return render(
    <QueryClientProvider client={qc}>
      <SessionContext.Provider value={makeSession(sessionOverrides)}>
        <MemoryRouter initialEntries={[`/p/${slug}/testcase/new`]}>
          <Routes>
            <Route
              path="/p/:projectSlug/:kind/new"
              element={<EditForm />}
            />
            <Route
              path="/p/:projectSlug/approvals/:proposalId"
              element={<div data-testid="approval-detail">Approval detail</div>}
            />
          </Routes>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}

function renderEditForm(
  wombatId = FIXTURE_TESTCASE_1.wombat_id,
  slug = "alpha-project",
  sessionOverrides: Partial<SessionContextValue> = {},
) {
  const qc = makeQC();
  return render(
    <QueryClientProvider client={qc}>
      <SessionContext.Provider value={makeSession(sessionOverrides)}>
        <MemoryRouter initialEntries={[`/p/${slug}/testcase/${wombatId}/edit`]}>
          <Routes>
            <Route
              path="/p/:projectSlug/:kind/:wombatId/edit"
              element={<EditForm />}
            />
            <Route
              path="/p/:projectSlug/approvals/:proposalId"
              element={<div data-testid="approval-detail">Approval detail</div>}
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

describe("EditForm — new content", () => {
  it("renders Title field and Propose change button", () => {
    renderNewForm();

    expect(screen.getByPlaceholderText(/content title/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /propose change/i })).toBeInTheDocument();
  });

  it("Propose change is disabled when title is empty", () => {
    renderNewForm();

    const proposeBtn = screen.getByRole("button", { name: /propose change/i });
    expect(proposeBtn).toBeDisabled();
  });

  it("renders Tags and Proposal summary fields", () => {
    renderNewForm();

    expect(screen.getByPlaceholderText(/tag1, tag2/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/brief description/i)).toBeInTheDocument();
  });

  it("renders info banner about proposal flow", () => {
    renderNewForm();

    expect(
      screen.getByText(/changes you submit here create a proposal/i),
    ).toBeInTheDocument();
  });
});

describe("EditForm — Publish directly button visibility", () => {
  it("does NOT show Publish directly when user lacks content:publish_direct", () => {
    const userWithoutDirectPublish = {
      ...FIXTURE_USER,
      permissions_by_project: {
        "alpha-project": ["content:propose"],
      },
    };
    renderNewForm("alpha-project", { user: userWithoutDirectPublish });

    expect(
      screen.queryByRole("button", { name: /publish directly/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Publish directly when user has content:publish_direct", () => {
    // FIXTURE_USER has content:publish_direct on alpha-project
    renderNewForm("alpha-project");

    expect(
      screen.getByRole("button", { name: /publish directly/i }),
    ).toBeInTheDocument();
  });
});

describe("EditForm — submit calls useCreateProposal", () => {
  it("submitting with title navigates to proposal detail on success", async () => {
    renderNewForm();

    const titleInput = screen.getByPlaceholderText(/content title/i);
    fireEvent.change(titleInput, { target: { value: "My new testcase" } });

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /propose change/i });
      expect(btn).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /propose change/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("approval-detail")).toBeInTheDocument();
    });
  });
});

describe("EditForm — 409 open_proposal_exists", () => {
  it("shows open-proposal banner with link on 409 open_proposal_exists", async () => {
    const existingProposalId = "eeeeeeee-0000-0000-0000-000000000001";

    server.use(
      http.post("*/api/projects/:slug/proposals", () => {
        return HttpResponse.json(
          {
            error: {
              code: "open_proposal_exists",
              message: "An open proposal already exists.",
              field: null,
              hint: JSON.stringify({ existing_proposal_id: existingProposalId }),
            },
          },
          { status: 409 },
        );
      }),
    );

    renderNewForm();

    const titleInput = screen.getByPlaceholderText(/content title/i);
    fireEvent.change(titleInput, { target: { value: "Duplicate proposal" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /propose change/i })).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /propose change/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/a proposal is already open/i),
      ).toBeInTheDocument();
    });

    // A link to the existing proposal should appear
    expect(screen.getByRole("link", { name: /view existing proposal/i })).toBeInTheDocument();
  });
});

describe("EditForm — edit existing content", () => {
  it("loads existing testcase and seeds the title field", async () => {
    renderEditForm();

    await waitFor(() => {
      const titleInput = screen.getByPlaceholderText(/content title/i) as HTMLInputElement;
      expect(titleInput.value).toBe(FIXTURE_TESTCASE_1.title);
    });
  });
});
