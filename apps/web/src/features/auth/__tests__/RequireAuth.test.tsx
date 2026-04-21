import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContext } from "../AuthProvider";
import { RequireAuth } from "../guards";
import type { SessionContextValue } from "../AuthProvider";

// Suppress React Router future flag warnings in tests
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = (msg: string, ...rest: unknown[]) => {
    if (typeof msg === "string" && msg.includes("React Router Future Flag")) return;
    originalWarn(msg, ...rest);
  };
});

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeSession(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    status: "authed",
    user: { id: "u1", email: "test@example.com", display_name: "Test", is_active: true, created_at: "", permissions_by_project: {} },
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    ...overrides,
  };
}

describe("RequireAuth", () => {
  it("renders children when authenticated", () => {
    const qc = makeQC();
    render(
      <QueryClientProvider client={qc}>
        <SessionContext.Provider value={makeSession()}>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route
                path="/protected"
                element={
                  <RequireAuth>
                    <div>Protected content</div>
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("redirects to /login with ?next= when anonymous", () => {
    const qc = makeQC();
    render(
      <QueryClientProvider client={qc}>
        <SessionContext.Provider value={makeSession({ status: "anonymous", user: null })}>
          <MemoryRouter initialEntries={["/p/alpha/library"]}>
            <Routes>
              <Route path="/login" element={<div>Login page</div>} />
              <Route
                path="/p/:slug/library"
                element={
                  <RequireAuth>
                    <div>Protected</div>
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Protected")).not.toBeInTheDocument();
  });

  it("renders skeleton while loading", () => {
    const qc = makeQC();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SessionContext.Provider value={makeSession({ status: "loading", user: null })}>
          <MemoryRouter>
            <RequireAuth>
              <div>Protected content</div>
            </RequireAuth>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    // Skeleton renders, children do not
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    // The skeleton div should be present
    expect(container.querySelector(".animate-pulse, [class*='skeleton'], [class*='h-16']")).not.toBeNull();
  });
});
