/**
 * Unit tests for FilterBuilder (SP3.4 Task 39).
 *
 * Test coverage:
 * - Adding a tag shows a chip + calls onChange
 * - Removing a chip mutates state
 * - Empty state shows the "+ Add tag" affordance
 * - Priority toggle: selecting a pill calls onChange with the priority included;
 *   deselecting removes it.
 * - Components: typing and blurring (or Enter) adds a chip + calls onChange.
 * - Backspace on empty tag input removes the last tag.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FilterBuilder } from "./FilterBuilder";
import type { FilterGroup, FilterBuilderProps } from "./FilterBuilder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyGroup(): FilterGroup {
  return { tags_any: [], priorities: [], components_any: [] };
}

function renderFilterBuilder(overrides?: Partial<FilterBuilderProps>) {
  const onChange = vi.fn();
  const props: FilterBuilderProps = {
    include: emptyGroup(),
    exclude: emptyGroup(),
    onChange,
    ...overrides,
  };
  const { rerender } = render(<FilterBuilder {...props} />);
  return { onChange, rerender, props };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe("FilterBuilder — tags (include group)", () => {
  it("shows the '+ Add tag' affordance when there are no tags", () => {
    renderFilterBuilder();
    // There are two add-tag buttons (one per group); look at include side
    const addButtons = screen.getAllByRole("button", { name: /add tag/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("adding a tag calls onChange with the new tag in include.tags_any", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    // Click the first "Add tag" button (include group)
    const [firstAddBtn] = screen.getAllByRole("button", { name: /add tag/i }) as [HTMLElement, ...HTMLElement[]];
    await user.click(firstAddBtn);

    // An input should now be visible
    const input = screen.getByPlaceholderText(/tag name/i);
    await user.type(input, "payments");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ tags_any: ["payments"] }),
      }),
    );
  });

  it("adding a tag with comma as delimiter also commits", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    const [firstAddBtn] = screen.getAllByRole("button", { name: /add tag/i }) as [HTMLElement, ...HTMLElement[]];
    await user.click(firstAddBtn);

    const input = screen.getByPlaceholderText(/tag name/i);
    await user.type(input, "checkout,");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ tags_any: ["checkout"] }),
      }),
    );
  });

  it("renders existing tag chips", () => {
    renderFilterBuilder({
      include: { tags_any: ["regression", "smoke"], priorities: [], components_any: [] },
    });

    expect(screen.getByText("regression")).toBeInTheDocument();
    expect(screen.getByText("smoke")).toBeInTheDocument();
  });

  it("removing a chip calls onChange with the tag removed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder({
      include: { tags_any: ["regression", "smoke"], priorities: [], components_any: [] },
    });

    const removeBtn = screen.getByRole("button", { name: /remove tag regression/i });
    await user.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ tags_any: ["smoke"] }),
      }),
    );
  });

  it("Escape key cancels the tag input without committing", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    const [firstAddBtn] = screen.getAllByRole("button", { name: /add tag/i }) as [HTMLElement, ...HTMLElement[]];
    await user.click(firstAddBtn);

    const input = screen.getByPlaceholderText(/tag name/i);
    await user.type(input, "draft");
    await user.keyboard("{Escape}");

    // onChange should NOT have been called with a new tag
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ tags_any: expect.arrayContaining(["draft"]) }),
      }),
    );
  });

  it("Backspace on empty input removes the last tag", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder({
      include: { tags_any: ["regression", "smoke"], priorities: [], components_any: [] },
    });

    const [firstAddBtn] = screen.getAllByRole("button", { name: /add tag/i }) as [HTMLElement, ...HTMLElement[]];
    await user.click(firstAddBtn);

    // Input is now focused; pressing Backspace should remove "smoke"
    await user.keyboard("{Backspace}");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ tags_any: ["regression"] }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

describe("FilterBuilder — priorities", () => {
  it("renders all five priority pills", () => {
    renderFilterBuilder();
    // Each group (include + exclude) has P0..P4 — total 10 pills
    const pills = screen.getAllByRole("checkbox");
    // At least 10 (5 per group × 2 groups)
    expect(pills.length).toBeGreaterThanOrEqual(10);
  });

  it("selecting a priority pill calls onChange with the priority in the include group", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    // Find P1 checkbox in the Include group
    const allP1 = screen.getAllByRole("checkbox", { name: /P1/i });
    // First checkbox is in include group (since include is rendered first)
    await user.click(allP1[0]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ priorities: ["P1"] }),
      }),
    );
  });

  it("deselecting a selected priority calls onChange without that priority", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder({
      include: { tags_any: [], priorities: ["P1", "P2"], components_any: [] },
    });

    const allP1 = screen.getAllByRole("checkbox", { name: /P1/i });
    await user.click(allP1[0]!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ priorities: ["P2"] }),
      }),
    );
  });

  it("selected pills have aria-checked=true", () => {
    renderFilterBuilder({
      include: { tags_any: [], priorities: ["P0"], components_any: [] },
    });

    const allP0 = screen.getAllByRole("checkbox", { name: /P0/i });
    // First is in include group
    expect(allP0[0]!).toHaveAttribute("aria-checked", "true");
    // Second is in exclude group (not selected)
    expect(allP0[1]!).toHaveAttribute("aria-checked", "false");
  });
});

// ---------------------------------------------------------------------------
// Exclude group
// ---------------------------------------------------------------------------

describe("FilterBuilder — exclude group", () => {
  it("adding a tag in the exclude group calls onChange with exclude.tags_any", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    // Second "Add tag" button is in the exclude group
    const addButtons = screen.getAllByRole("button", { name: /add tag/i });
    const excludeAddBtn = addButtons[addButtons.length - 1]!;
    await user.click(excludeAddBtn);

    const input = screen.getByPlaceholderText(/tag name/i);
    await user.type(input, "flaky");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exclude: expect.objectContaining({ tags_any: ["flaky"] }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Components (free-text)
// ---------------------------------------------------------------------------

describe("FilterBuilder — components (free-text fallback)", () => {
  it("typing in the components field and blurring adds a chip", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    const inputs = screen.getAllByPlaceholderText(/component name/i);
    await user.click(inputs[0]!);
    await user.type(inputs[0]!, "checkout-ui");
    await user.tab(); // blur

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ components_any: ["checkout-ui"] }),
      }),
    );
  });

  it("Enter key commits the component", async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilterBuilder();

    const inputs = screen.getAllByPlaceholderText(/component name/i);
    await user.click(inputs[0]!);
    await user.type(inputs[0]!, "payment-sdk");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ components_any: ["payment-sdk"] }),
      }),
    );
  });
});
