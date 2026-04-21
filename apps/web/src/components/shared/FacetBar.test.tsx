import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FacetBar } from "./FacetBar";

const AVAILABLE = ["tag", "priority", "component"];

describe("FacetBar", () => {
  it("renders active filter pills", () => {
    render(
      <FacetBar
        values={[
          { key: "tag", value: "smoke" },
          { key: "priority", value: "high" },
        ]}
        available={AVAILABLE}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("smoke")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("removing a pill calls onChange with correct payload", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <FacetBar
        values={[
          { key: "tag", value: "smoke" },
          { key: "priority", value: "high" },
        ]}
        available={AVAILABLE}
        onChange={handleChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /remove filter tag: smoke/i }));
    expect(handleChange).toHaveBeenCalledWith([{ key: "priority", value: "high" }]);
  });

  it("add-filter button is keyboard reachable", async () => {
    const user = userEvent.setup();
    render(
      <FacetBar values={[]} available={AVAILABLE} onChange={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: /add filter/i });
    await user.tab();
    expect(btn).toHaveFocus();
  });

  it("opens popover and calls onChange when a facet is added", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <FacetBar values={[]} available={AVAILABLE} onChange={handleChange} />,
    );

    // Open popover
    await user.click(screen.getByRole("button", { name: /add filter/i }));

    // Wait for the field selector to appear
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /filter field/i })).toBeInTheDocument();
    });

    // Select "tag" in the native select
    const fieldSelect = screen.getByRole("combobox", { name: /filter field/i });
    await user.selectOptions(fieldSelect, "tag");

    // Type a value
    const valueInput = screen.getByPlaceholderText(/enter value/i);
    await user.type(valueInput, "regression");

    // Click Apply
    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(handleChange).toHaveBeenCalledWith([
      { key: "tag", value: "regression" },
    ]);
  });

  it("Enter in value input commits the filter", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <FacetBar values={[]} available={AVAILABLE} onChange={handleChange} />,
    );

    await user.click(screen.getByRole("button", { name: /add filter/i }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /filter field/i })).toBeInTheDocument();
    });

    const fieldSelect = screen.getByRole("combobox", { name: /filter field/i });
    await user.selectOptions(fieldSelect, "tag");

    const valueInput = screen.getByPlaceholderText(/enter value/i);
    await user.type(valueInput, "smoke{Enter}");

    expect(handleChange).toHaveBeenCalledWith([{ key: "tag", value: "smoke" }]);
  });
});
