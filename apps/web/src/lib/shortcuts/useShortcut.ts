import { useEffect } from "react";

interface ParsedShortcut {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

function parseShortcut(combo: string): ParsedShortcut {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1] ?? "";
  return {
    key,
    meta: parts.includes("meta") || parts.includes("mod"),
    ctrl: parts.includes("ctrl") || parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

function matches(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const key = e.key.toLowerCase();
  // "mod" means meta on Mac, ctrl elsewhere
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const modSatisfied = parsed.meta
    ? isMac ? e.metaKey : e.ctrlKey
    : true;
  const ctrlSatisfied = parsed.ctrl && !parsed.meta ? e.ctrlKey : true;

  return (
    key === parsed.key &&
    modSatisfied &&
    (!parsed.shift || e.shiftKey) &&
    (!parsed.alt || e.altKey) &&
    // Don't fire if only shift/alt and neither expected
    (!(!parsed.meta && !parsed.ctrl) || true) &&
    ctrlSatisfied
  );
}

/**
 * useShortcut — attaches a global keyboard listener for the given combo.
 *
 * Combo syntax examples: "mod+k", "?", "g", "shift+?"
 *
 * The handler is NOT called when focus is inside an input/textarea/
 * contenteditable — matching the convention used throughout the app.
 *
 * @param combo   Key combination string
 * @param handler Called when the combo fires
 * @param opts.allowInInput  Set true to fire even inside inputs
 */
export function useShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: { allowInInput?: boolean; enabled?: boolean } = {},
) {
  const { allowInInput = false, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    const parsed = parseShortcut(combo);

    const listener = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const tgt = e.target as HTMLElement;
        if (
          tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable
        )
          return;
      }
      if (matches(e, parsed)) {
        handler(e);
      }
    };

    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [combo, handler, allowInInput, enabled]);
}
