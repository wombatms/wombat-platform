import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "../CommandPalette";
import { FIXTURE_SEARCH_RESULT } from "@/tests/fixtures/search";

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
});

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderPalette(open = true, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/p/alpha/library"]}>
          <Routes>
            <Route
              path="/p/:projectSlug/*"
              element={
                <>
                  <CommandPalette open={open} onClose={onClose} />
                  <LocationDisplay />
                </>
              }
            />
            <Route path="*" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    renderPalette(false);
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("renders dialog with search input when open", () => {
    renderPalette(true);
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search testcases/i)).toBeInTheDocument();
  });

  it("shows 'Type to search' prompt for short queries", () => {
    renderPalette(true);
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it("debounces query and shows results after 150ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderPalette(true);

    const input = screen.getByPlaceholderText(/search testcases/i);
    await user.type(input, "lo");

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // MSW responds; wait for results
    await waitFor(() => {
      expect(
        screen.getByText(FIXTURE_SEARCH_RESULT.hits[0]!.title),
      ).toBeInTheDocument();
    });

    vi.useRealTimers();
  }, 10_000);

  it("groups results by kind heading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderPalette(true);

    const input = screen.getByPlaceholderText(/search testcases/i);
    await user.type(input, "lo");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(screen.getByText("Testcases")).toBeInTheDocument();
      expect(screen.getByText("Shared Steps")).toBeInTheDocument();
      expect(screen.getByText("Stories")).toBeInTheDocument();
    });

    vi.useRealTimers();
  }, 10_000);

  it("calls onClose when Escape is pressed in input", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPalette(true, onClose);

    const input = screen.getByPlaceholderText(/search testcases/i);
    input.focus();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to correct path when a result is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const onClose = vi.fn();
    renderPalette(true, onClose);

    const input = screen.getByPlaceholderText(/search testcases/i);
    await user.type(input, "lo");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const firstHit = FIXTURE_SEARCH_RESULT.hits[0]!;
    await waitFor(() => {
      expect(screen.getByText(firstHit.title)).toBeInTheDocument();
    });

    await user.click(screen.getByText(firstHit.title));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const expectedPath = `/p/alpha/library/${firstHit.wombat_id}`;
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(expectedPath);
    });

    vi.useRealTimers();
  }, 10_000);
});
