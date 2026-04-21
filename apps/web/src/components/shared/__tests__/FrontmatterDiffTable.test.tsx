import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FrontmatterDiffTable } from "../FrontmatterDiffTable";

describe("FrontmatterDiffTable", () => {
  it("shows changed keys by default", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Old title", priority: "P1", tags: ["a"] }}
        after={{ title: "New title", priority: "P1", tags: ["a"] }}
      />,
    );

    // The changed key "title" should be visible
    expect(screen.getByText("title")).toBeInTheDocument();
    // The old value should be visible (struck through)
    expect(screen.getByText("Old title")).toBeInTheDocument();
    // The new value should be visible
    expect(screen.getByText("New title")).toBeInTheDocument();
  });

  it("hides unchanged keys by default", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Changed", priority: "P1", tags: ["a"] }}
        after={{ title: "New changed", priority: "P1", tags: ["a"] }}
      />,
    );

    // "priority" and "tags" are unchanged — toggle button should reference them
    const toggleBtn = screen.getByRole("button", { name: /show.*unchanged/i });
    expect(toggleBtn).toBeInTheDocument();

    // The unchanged rows should not be visible initially (they are hidden)
    // They appear after the toggle; confirm toggle button says "Show 2 unchanged fields"
    expect(toggleBtn.textContent).toMatch(/show 2 unchanged/i);
  });

  it("toggle reveals unchanged fields", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Changed", priority: "P1" }}
        after={{ title: "New changed", priority: "P1" }}
      />,
    );

    // "priority" is unchanged; initially hidden
    const toggleBtn = screen.getByRole("button", { name: /show.*unchanged/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click to reveal
    fireEvent.click(toggleBtn);

    // After toggle, "priority" should be visible in the table
    expect(screen.getByText("priority")).toBeInTheDocument();
    // And the toggle button label changes
    expect(toggleBtn.textContent).toMatch(/hide 1 unchanged/i);
  });

  it("toggle collapses unchanged fields when clicked again", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Changed", priority: "P1" }}
        after={{ title: "New value", priority: "P1" }}
      />,
    );

    const toggleBtn = screen.getByRole("button", { name: /show.*unchanged/i });
    // Open
    fireEvent.click(toggleBtn);
    expect(screen.getByText("priority")).toBeInTheDocument();

    // Close again
    fireEvent.click(toggleBtn);
    expect(toggleBtn.textContent).toMatch(/show 1 unchanged/i);
  });

  it("shows 'No changed fields' message when nothing changed", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Same" }}
        after={{ title: "Same" }}
      />,
    );

    expect(screen.getByText(/no changed fields/i)).toBeInTheDocument();
  });

  it("renders empty state when both objects are empty", () => {
    render(<FrontmatterDiffTable before={{}} after={{}} />);
    expect(screen.getByText(/no frontmatter fields/i)).toBeInTheDocument();
  });

  it("handles key only in after (addition)", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "Old" }}
        after={{ title: "Old", new_key: "added value" }}
      />,
    );

    // new_key should appear as changed (added)
    expect(screen.getByText("new_key")).toBeInTheDocument();
    expect(screen.getByText("added value")).toBeInTheDocument();
  });

  it("renders the table with correct aria-label", () => {
    render(
      <FrontmatterDiffTable
        before={{ title: "A" }}
        after={{ title: "B" }}
      />,
    );

    expect(
      screen.getByRole("table", { name: /frontmatter diff/i }),
    ).toBeInTheDocument();
  });
});
