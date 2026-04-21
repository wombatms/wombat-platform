import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";

describe("smoke", () => {
  it("renders", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <div>Hello Wombat</div>
      </MemoryRouter>,
    );
    expect(screen.getByText("Hello Wombat")).toBeInTheDocument();
  });
});
