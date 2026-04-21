import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MarkdownDiffSplit } from "../MarkdownDiffSplit";

describe("MarkdownDiffSplit — rendered mode", () => {
  it("renders Before and After pane labels", () => {
    render(
      <MarkdownDiffSplit
        before="# Hello"
        after="# Hello world"
        mode="rendered"
      />,
    );

    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
  });

  it("renders content in both panes", () => {
    render(
      <MarkdownDiffSplit
        before="Old content here"
        after="New content here"
        mode="rendered"
      />,
    );

    // Both panes should render their content via MarkdownBody
    expect(screen.getByText("Old content here")).toBeInTheDocument();
    expect(screen.getByText("New content here")).toBeInTheDocument();
  });

  it("renders 'Empty' for empty before pane", () => {
    render(
      <MarkdownDiffSplit before="" after="After content" mode="rendered" />,
    );

    // When before is empty, a placeholder text appears
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });
});

describe("MarkdownDiffSplit — raw mode", () => {
  it("renders lines with + / - prefixes for changed lines", () => {
    render(
      <MarkdownDiffSplit
        before="unchanged line\nold line"
        after="unchanged line\nnew line"
        mode="raw"
      />,
    );

    // In raw mode, the diff lines are rendered with + / - prefixes
    // Look for the prefix elements (aria-hidden spans)
    const prefixes = document.querySelectorAll('[aria-hidden="true"]');
    const prefixTexts = Array.from(prefixes).map((el) => el.textContent);

    // Should have at least one + and one - prefix
    expect(prefixTexts).toContain("+");
    expect(prefixTexts).toContain("-");
  });

  it("shows changed line content", () => {
    render(
      <MarkdownDiffSplit
        before="removed line"
        after="added line"
        mode="raw"
      />,
    );

    expect(screen.getByText("removed line")).toBeInTheDocument();
    expect(screen.getByText("added line")).toBeInTheDocument();
  });

  it("does not render Before/After pane labels in raw mode", () => {
    render(
      <MarkdownDiffSplit
        before="before content"
        after="after content"
        mode="raw"
      />,
    );

    // In raw mode, there are no "Before" / "After" pane headers
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(screen.queryByText("After")).not.toBeInTheDocument();
  });
});

describe("MarkdownDiffSplit — synchronized scroll", () => {
  beforeEach(() => {
    // Mock requestAnimationFrame
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it("fires onScroll on the left pane without throwing", () => {
    render(
      <MarkdownDiffSplit
        before="line 1\nline 2\nline 3\nline 4"
        after="line 1\nline 2\nline 3\nline 5"
        mode="rendered"
      />,
    );

    // Find the scrollable pane divs — they have onScroll handlers
    // The left pane has a scroll container with class including "flex-1 overflow-auto"
    const scrollContainers = document.querySelectorAll(
      ".flex-1.overflow-auto",
    );

    // There should be 2 scroll panes (left + right)
    expect(scrollContainers.length).toBeGreaterThanOrEqual(2);

    // Firing scroll on left pane should not throw
    expect(() => {
      fireEvent.scroll(scrollContainers[0]!);
    }).not.toThrow();
  });

  it("fires onScroll on the right pane without throwing", () => {
    render(
      <MarkdownDiffSplit
        before="line 1\nline 2"
        after="line 1\nline 3"
        mode="rendered"
      />,
    );

    const scrollContainers = document.querySelectorAll(".flex-1.overflow-auto");
    expect(scrollContainers.length).toBeGreaterThanOrEqual(2);

    expect(() => {
      fireEvent.scroll(scrollContainers[1]!);
    }).not.toThrow();
  });
});
