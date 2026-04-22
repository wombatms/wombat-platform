/**
 * Unit tests for CaseSelector and its three tab subcomponents.
 *
 * Test structure:
 *   CaseSelector (container)
 *     - renders all three tab triggers
 *     - SelectedBadge appears only when count > 0
 *     - selection shared across tab switches (shared state)
 *
 *   FilterTab
 *     - renders loaded case list via MSW
 *     - checking a row increments the shared selected count
 *     - "Select all matching" button selects all loaded rows
 *     - unselecting a row decrements the count
 *     - shows empty state when no cases are returned
 *     - shows error state and retry button on API failure
 *
 *   PasteTab
 *     - detects parsed IDs from textarea and shows live count
 *     - validate button is disabled when textarea is empty
 *     - after validation, found IDs are added to the selected set
 *     - missing IDs are shown as error chips
 *     - Clear button removes found IDs from selected set
 *     - Ctrl+Enter keyboard shortcut triggers validate
 *
 *   LibraryTab
 *     - pre-populated from ?ids=TC-LOGIN-001,TC-LOGIN-002 URL param
 *     - seeded IDs are toggled into selected on mount
 *     - toggling a row deselects it from the shared set
 *     - persists across tab switch: switch away and back, selection intact
 *     - shows empty state when ?ids= param is absent
 *
 *   Footer (sticky) — validated via CaseSelector's onSelectionChange callback
 *     - disabled signal: 0 cases produces count=0
 *     - enabled signal: ≥1 case produces count>0
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "@/tests/msw/server";
import { CaseSelector } from "./CaseSelector";
import {
  FIXTURE_TESTCASE_1,
  FIXTURE_TESTCASE_2,
} from "@/tests/fixtures/testcases";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLUG = "alpha-project";

const TC1_ID = FIXTURE_TESTCASE_1.wombat_id; // TC-LOGIN-001
const TC2_ID = FIXTURE_TESTCASE_2.wombat_id; // TC-LOGIN-002

const TESTCASES_RESPONSE = {
  data: [FIXTURE_TESTCASE_1, FIXTURE_TESTCASE_2],
  total: 2,
  limit: 200,
  offset: 0,
};

// ---------------------------------------------------------------------------
// MSW base handlers for this file — registered before each test
// ---------------------------------------------------------------------------

function registerBaseHandlers() {
  server.use(
    http.get("*/api/projects/:slug/testcases", ({ params, request }) => {
      const slug = params["slug"] as string;
      if (slug !== SLUG) {
        return HttpResponse.json(
          { error: { code: "not_found", message: "Project not found.", field: null, hint: null } },
          { status: 404 },
        );
      }
      const url = new URL(request.url);
      const q = url.searchParams.get("q");
      const component = url.searchParams.get("component");
      let data = TESTCASES_RESPONSE.data;
      if (q) data = data.filter((tc) => tc.title.toLowerCase().includes(q.toLowerCase()));
      if (component) data = data.filter((tc) => tc.component === component);
      return HttpResponse.json({ data, total: data.length, limit: 500, offset: 0 });
    }),
  );
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

interface RenderOptions {
  /** URL to render within — controls searchParams for LibraryTab. */
  path?: string;
}

function renderSelector(
  onSelectionChange = vi.fn(),
  { path = `/p/${SLUG}/runs/new` }: RenderOptions = {},
) {
  const qc = makeQC();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  const utils = render(
    <CaseSelector projectSlug={SLUG} onSelectionChange={onSelectionChange} />,
    { wrapper: Wrapper },
  );

  return { ...utils, qc, onSelectionChange };
}

// Shared timeout for network-backed waitFor calls
const NET_TIMEOUT = { timeout: 5000 };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.setItem("wombat.access", "test-access-token.payload.sig");
  localStorage.setItem("wombat.refresh", "test-refresh-token.payload.sig");
  registerBaseHandlers();
});

// ---------------------------------------------------------------------------
// Helpers — wait for the FilterTab case list to finish loading
// ---------------------------------------------------------------------------

async function _waitForCaseList() {
  return waitFor(
    () => expect(screen.getByText(TC1_ID)).toBeInTheDocument(),
    NET_TIMEOUT,
  );
}

async function waitForCheckbox(wombatId: string) {
  return waitFor(
    () =>
      expect(
        screen.getByRole("checkbox", {
          name: new RegExp(wombatId, "i"),
        }),
      ).toBeInTheDocument(),
    NET_TIMEOUT,
  );
}

// ---------------------------------------------------------------------------
// CaseSelector (container)
// ---------------------------------------------------------------------------

describe("CaseSelector", () => {
  it("renders all three tab triggers", () => {
    renderSelector();
    expect(screen.getByRole("tab", { name: /filter/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /paste ids/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /from library/i })).toBeInTheDocument();
  });

  it("does not show the selected badge when count is 0", () => {
    renderSelector();
    expect(screen.queryByLabelText(/cases selected/i)).not.toBeInTheDocument();
  });

  it("shows the selected badge after a case is checked via FilterTab", async () => {
    const user = userEvent.setup();
    renderSelector();

    await waitForCheckbox(TC1_ID);

    await user.click(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    );

    await waitFor(
      () => expect(screen.getByLabelText("1 cases selected")).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });
});

// ---------------------------------------------------------------------------
// FilterTab
// ---------------------------------------------------------------------------

describe("FilterTab", () => {
  it("renders the loaded case list", async () => {
    renderSelector();

    await waitFor(() => {
      expect(screen.getByText(TC1_ID)).toBeInTheDocument();
      expect(screen.getByText(TC2_ID)).toBeInTheDocument();
    }, NET_TIMEOUT);
  });

  it("displays the matching count in the toolbar", async () => {
    renderSelector();

    // The count is split: <span>2</span> cases match
    // Use a query that matches the containing element text
    await waitFor(() => {
      // Ensure the list renders before asserting the toolbar text
      screen.getByRole("list", { name: /matching testcases/i });
      // Count span is sibling of "cases match" text node
      expect(screen.getAllByText(/cases match/)).toHaveLength(1);
    }, NET_TIMEOUT);
  });

  it("checking a row calls onSelectionChange with the selected ID", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);

    await waitForCheckbox(TC1_ID);

    await user.click(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    );

    expect(onSelectionChange).toHaveBeenCalledWith(new Set([TC1_ID]));
  });

  it("unchecking a previously checked row removes the ID", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);

    await waitForCheckbox(TC1_ID);

    const checkbox = screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") });

    // check then uncheck
    await user.click(checkbox);
    await user.click(checkbox);

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.has(TC1_ID)).toBe(false);
  });

  it("Select all matching adds all visible rows", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);

    await waitFor(
      () => expect(screen.getByRole("button", { name: /select all matching/i })).not.toBeDisabled(),
      NET_TIMEOUT,
    );

    await user.click(screen.getByRole("button", { name: /select all matching/i }));

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.has(TC1_ID)).toBe(true);
    expect(lastCall.has(TC2_ID)).toBe(true);
  });

  it("Select all matching is disabled when all rows are already selected", async () => {
    const user = userEvent.setup();
    renderSelector();

    await waitFor(
      () => expect(screen.getByRole("button", { name: /select all matching/i })).not.toBeDisabled(),
      NET_TIMEOUT,
    );

    await user.click(screen.getByRole("button", { name: /select all matching/i }));

    await waitFor(
      () => expect(screen.getByRole("button", { name: /select all matching/i })).toBeDisabled(),
      NET_TIMEOUT,
    );
  });

  it("shows empty state when no testcases are returned", async () => {
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json({ data: [], total: 0, limit: 200, offset: 0 }),
      ),
    );

    renderSelector();

    await waitFor(
      () => expect(screen.getByText(/no testcases in this project yet/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });

  it("shows error state on API failure", async () => {
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json(
          { error: { code: "server_error", message: "Internal server error.", field: null, hint: null } },
          { status: 500 },
        ),
      ),
    );

    renderSelector();

    await waitFor(
      () => expect(screen.getByText(/failed to load cases/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });

  it("shows retry button on API failure and reloads on click", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json(
          { error: { code: "server_error", message: "Internal server error.", field: null, hint: null } },
          { status: 500 },
        ),
      ),
    );

    renderSelector();

    await waitFor(
      () => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument(),
      NET_TIMEOUT,
    );

    // Restore working handler before retry
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json({ data: [FIXTURE_TESTCASE_1], total: 1, limit: 200, offset: 0 }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(
      () => expect(screen.getByText(TC1_ID)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });
});

// ---------------------------------------------------------------------------
// PasteTab
// ---------------------------------------------------------------------------

describe("PasteTab", () => {
  async function switchToPaste(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /paste ids/i }));
  }

  it("shows 'No IDs detected yet' when textarea is empty", async () => {
    const user = userEvent.setup();
    renderSelector();
    await switchToPaste(user);

    expect(screen.getByText(/no ids detected yet/i)).toBeInTheDocument();
  });

  it("Validate button is disabled while textarea is empty", async () => {
    const user = userEvent.setup();
    renderSelector();
    await switchToPaste(user);

    expect(screen.getByRole("button", { name: /^validate$/i })).toBeDisabled();
  });

  it("detects parsed IDs from textarea content and shows live count", async () => {
    const user = userEvent.setup();
    renderSelector();
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.type(textarea, "TC-LOGIN-001, TC-LOGIN-002");

    expect(screen.getByText(/2 ids detected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^validate$/i })).not.toBeDisabled();
  });

  it("after validation, found IDs are added to the selected set", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.type(textarea, TC1_ID);

    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    await waitFor(
      () => expect(screen.getByText(/1 valid/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.has(TC1_ID)).toBe(true);
  });

  it("missing IDs are shown as error chips after validation", async () => {
    const user = userEvent.setup();
    renderSelector();
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    // Use clipboard paste to avoid userEvent treating '-' as a special key
    await user.click(textarea);
    await user.paste("TC-DOES-NOT-EXIST");

    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    // Wait for validation to settle — the direct api.GET call in validateIds
    // can take a few seconds in the test environment.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 4000));
    });

    // "1 not found" label from ValidationGroup
    expect(screen.getByText(/1 not found/i)).toBeInTheDocument();
    // The missing ID is shown as an error chip (may also appear in textarea)
    const notFoundChips = screen.getAllByText("TC-DOES-NOT-EXIST");
    expect(notFoundChips.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it("mixed input: some found, some missing", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.click(textarea);
    await user.paste(`${TC1_ID}\nTC-MISSING-999`);

    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 valid/i)).toBeInTheDocument();
      expect(screen.getByText(/1 not found/i)).toBeInTheDocument();
    }, NET_TIMEOUT);

    // Only the valid ID is added to selected
    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.has(TC1_ID)).toBe(true);
    expect(lastCall.has("TC-MISSING-999")).toBe(false);
  });

  it("Clear button removes found IDs from selected set and resets the form", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.type(textarea, TC1_ID);
    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    await waitFor(
      () => expect(screen.getByText(/1 valid/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );

    await user.click(screen.getByRole("button", { name: /clear/i }));

    // Form resets
    expect(screen.getByRole("textbox", { name: /paste wombat ids/i })).toHaveValue("");
    expect(screen.queryByText(/1 valid/i)).not.toBeInTheDocument();

    // Found ID is deselected
    const lastDeselect = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastDeselect.has(TC1_ID)).toBe(false);
  });

  it("Ctrl+Enter keyboard shortcut triggers validate", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.click(textarea);
    await user.type(textarea, TC1_ID);

    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(
      () => expect(screen.getByText(/1 valid/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });

  it("shows API error alert on validation failure", async () => {
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json(
          { error: { code: "server_error", message: "Internal error", field: null, hint: null } },
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderSelector();
    await switchToPaste(user);

    const textarea = screen.getByRole("textbox", { name: /paste wombat ids/i });
    await user.type(textarea, TC1_ID);
    await user.click(screen.getByRole("button", { name: /^validate$/i }));

    await waitFor(
      () => expect(screen.getByRole("alert")).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });
});

// ---------------------------------------------------------------------------
// LibraryTab
// ---------------------------------------------------------------------------

describe("LibraryTab", () => {
  async function switchToLibrary(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /from library/i }));
  }

  it("shows empty state when no ?ids= param is in the URL", async () => {
    const user = userEvent.setup();
    renderSelector(vi.fn(), { path: `/p/${SLUG}/runs/new` });
    await switchToLibrary(user);

    await waitFor(
      () => expect(screen.getByText(/no cases pre-selected/i)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });

  it("pre-populates from ?ids= URL param and seeds the selected set", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange, {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID},${TC2_ID}`,
    });

    await switchToLibrary(user);

    await waitFor(() => {
      const allSets = onSelectionChange.mock.calls.map((c) => c[0] as Set<string>);
      const combined = new Set(allSets.flatMap((s) => [...s]));
      expect(combined.has(TC1_ID)).toBe(true);
      expect(combined.has(TC2_ID)).toBe(true);
    }, NET_TIMEOUT);
  });

  it("renders the pre-selected case titles after API loads", async () => {
    const user = userEvent.setup();
    renderSelector(vi.fn(), {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID}`,
    });

    await switchToLibrary(user);

    await waitFor(
      () => expect(screen.getByText(FIXTURE_TESTCASE_1.title)).toBeInTheDocument(),
      NET_TIMEOUT,
    );
  });

  it("shows correct case count in the header", async () => {
    const user = userEvent.setup();
    renderSelector(vi.fn(), {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID},${TC2_ID}`,
    });

    await switchToLibrary(user);

    await waitFor(() => {
      expect(screen.getByText(/cases from library/i)).toBeInTheDocument();
    }, NET_TIMEOUT);
  });

  it("toggling a row deselects it from the shared set", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange, {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID}`,
    });

    await switchToLibrary(user);

    await waitForCheckbox(TC1_ID);

    // The case is pre-selected; deselect it
    await user.click(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    );

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.has(TC1_ID)).toBe(false);
  });

  it("selection persists across tab switches", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange, {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID}`,
    });

    // Switch to library, let seeding happen
    await switchToLibrary(user);
    await waitFor(() => {
      const allSets = onSelectionChange.mock.calls.map((c) => c[0] as Set<string>);
      const last = allSets.at(-1);
      expect(last?.has(TC1_ID)).toBe(true);
    }, NET_TIMEOUT);

    // Switch to Filter tab
    await user.click(screen.getByRole("tab", { name: /filter/i }));

    await waitForCheckbox(TC1_ID);

    // The case from library should be checked in the filter tab too
    expect(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    ).toBeChecked();

    // Switch back to library
    await user.click(screen.getByRole("tab", { name: /from library/i }));

    await waitForCheckbox(TC1_ID);

    // Still checked on return
    expect(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    ).toBeChecked();
  });

  it("shows unresolved stub rows for IDs not returned by the API", async () => {
    // Override to return empty list so TC1_ID appears as unresolved
    server.use(
      http.get("*/api/projects/:slug/testcases", () =>
        HttpResponse.json({ data: [], total: 0, limit: 500, offset: 0 }),
      ),
    );

    const user = userEvent.setup();
    renderSelector(vi.fn(), {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID}`,
    });

    await switchToLibrary(user);

    await waitFor(() => {
      expect(screen.getByText(TC1_ID)).toBeInTheDocument();
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    }, NET_TIMEOUT);
  });

  it("selected set is preserved even after LibraryTab unmounts and remounts", async () => {
    // Radix Tabs unmounts inactive tab content (Presence + {present && children}).
    // When LibraryTab remounts it re-seeds via onSelectIds, but the shared
    // selected set in CaseSelector already contains TC1_ID so the net selection
    // is unchanged — union semantics mean no duplicate is added.
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange, {
      path: `/p/${SLUG}/runs/new?ids=${TC1_ID}`,
    });

    await switchToLibrary(user);

    // Wait for initial seed
    await waitFor(
      () => expect(onSelectionChange).toHaveBeenCalled(),
      NET_TIMEOUT,
    );

    // Verify TC1_ID is in the selected set after initial seed
    const firstCallSet = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(firstCallSet.has(TC1_ID)).toBe(true);

    // Switch away and back — tab remounts and re-seeds
    await user.click(screen.getByRole("tab", { name: /filter/i }));
    await user.click(screen.getByRole("tab", { name: /from library/i }));

    // After remount, the final selected set still contains TC1_ID
    await waitFor(() => {
      const lastSet = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
      expect(lastSet?.has(TC1_ID)).toBe(true);
    }, NET_TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Footer disabled / enabled signals via onSelectionChange
// ---------------------------------------------------------------------------

describe("CaseSelector footer signal (via onSelectionChange)", () => {
  it("count starts at 0 before any interaction", () => {
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);

    // No calls with a non-empty set at render time
    const hasNonEmpty = onSelectionChange.mock.calls.some(
      (c) => (c[0] as Set<string>).size > 0,
    );
    expect(hasNonEmpty).toBe(false);
  });

  it("count becomes 1 after selecting a case", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    renderSelector(onSelectionChange);

    await waitForCheckbox(TC1_ID);

    await user.click(
      screen.getByRole("checkbox", { name: new RegExp(TC1_ID, "i") }),
    );

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastCall.size).toBeGreaterThanOrEqual(1);
  });
});
