import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectSwitcher } from "../ProjectSwitcher";

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
});

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Captures the current location so tests can assert navigation. */
function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

describe("ProjectSwitcher", () => {
  it("shows the current project name", async () => {
    const qc = makeQC();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/p/alpha/library"]}>
          <Routes>
            <Route path="/p/:projectSlug/*" element={<ProjectSwitcher />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Wait for projects to load via MSW
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /switch project/i })).toBeInTheDocument();
    });
    // Current project "Alpha Project" should appear in the trigger
    await waitFor(() => {
      expect(screen.getByText(/alpha project/i)).toBeInTheDocument();
    });
  });

  it("selecting a different project navigates to its library", async () => {
    const user = userEvent.setup();
    const qc = makeQC();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/p/alpha/library"]}>
          <Routes>
            <Route
              path="/p/:projectSlug/*"
              element={
                <>
                  <ProjectSwitcher />
                  <LocationDisplay />
                </>
              }
            />
            <Route path="*" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Wait for projects to be available
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /switch project/i })).toBeInTheDocument();
    });

    // Open the popover
    await user.click(screen.getByRole("combobox", { name: /switch project/i }));

    // Wait for Beta Project to appear in the dropdown
    await waitFor(() => {
      expect(screen.getByText(/beta project/i)).toBeInTheDocument();
    });

    // Select Beta Project
    await user.click(screen.getByText(/beta project/i));

    // Navigation should have happened
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/p/beta/library");
    });
  });
});
