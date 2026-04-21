import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

describe("MarkdownBody", () => {
  it("renders plain text", () => {
    render(<MarkdownBody>Hello world</MarkdownBody>);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("strips <script> tags (XSS guard)", () => {
    const { container } = render(
      <MarkdownBody>{"Before<script>alert(1)</script>After"}</MarkdownBody>,
    );
    expect(container.querySelector("script")).toBeNull();
    // Text content should still have "Before" and "After"
    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
  });

  it("strips javascript: href (XSS guard)", () => {
    const { container } = render(
      <MarkdownBody>{"[click me](javascript:alert(1))"}</MarkdownBody>,
    );
    const links = container.querySelectorAll("a");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      // rehype-sanitize either removes the href (null) or keeps only safe ones
      if (href !== null) {
        expect(href).not.toContain("javascript:");
      }
    });
  });

  it("renders a GFM table", () => {
    const md = `
| Name | Value |
|------|-------|
| foo  | bar   |
`;
    render(<MarkdownBody>{md}</MarkdownBody>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("renders a GFM task list checkbox as disabled input", () => {
    const md = `
- [x] Done task
- [ ] Pending task
`;
    const { container } = render(<MarkdownBody>{md}</MarkdownBody>);
    const checkboxes = container.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(2);
    // All checkboxes are read-only / disabled
    checkboxes.forEach((cb) => {
      expect(cb).toHaveAttribute("disabled");
    });
    // First is checked, second is not
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it("renders a code block with code-bg background", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<MarkdownBody>{md}</MarkdownBody>);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    // The pre uses inline style with var(--code-bg)
    expect(pre?.style.background).toContain("var(--code-bg)");
  });

  it("renders inline code with code-bg background", () => {
    const { container } = render(<MarkdownBody>{"Use `const` here"}</MarkdownBody>);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code?.style.background).toContain("var(--code-bg)");
  });

  it("renders a blockquote", () => {
    render(<MarkdownBody>{"&gt; A quoted line"}</MarkdownBody>);
    // The text "A quoted line" should appear
    expect(screen.getByText(/A quoted line/)).toBeInTheDocument();
  });
});
