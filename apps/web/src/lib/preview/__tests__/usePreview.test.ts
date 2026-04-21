import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { usePreview } from "../usePreview";

beforeEach(() => {
  localStorage.clear();
});

describe("usePreview", () => {
  it("starts closed by default", () => {
    const { result } = renderHook(() => usePreview("library"));
    expect(result.current[0]).toBe(false);
  });

  it("toggle opens and closes", () => {
    const { result } = renderHook(() => usePreview("library"));
    act(() => result.current[2]());
    expect(result.current[0]).toBe(true);
    act(() => result.current[2]());
    expect(result.current[0]).toBe(false);
  });

  it("persists state to localStorage", () => {
    const { result } = renderHook(() => usePreview("library"));
    act(() => result.current[1](true));
    expect(localStorage.getItem("wombat.preview.library")).toBe("true");
  });

  it("reads persisted state on mount", () => {
    localStorage.setItem("wombat.preview.library", "true");
    const { result } = renderHook(() => usePreview("library"));
    expect(result.current[0]).toBe(true);
  });

  it("p key on document toggles preview when wired", () => {
    // The `p` shortcut is wired in LibraryPage, not usePreview itself.
    // We test toggle() directly which is what the keydown handler calls.
    const { result } = renderHook(() => usePreview("stories"));
    expect(result.current[0]).toBe(false);
    act(() => result.current[2]());
    expect(result.current[0]).toBe(true);
  });
});
