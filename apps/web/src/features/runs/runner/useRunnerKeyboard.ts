/**
 * useRunnerKeyboard — centralised keyboard hook for the Execution Runner.
 *
 * Handles all shortcuts defined in SP3.3 spec §8.6:
 *   p / f / b / s   — record pass / fail / blocked / skipped
 *   f then digit    — record fail with failed_at_step = digit (1-9)
 *   ← / →           — previous / next case
 *   ↑ / ↓           — previous / next row (grid mode)
 *   n               — focus notes field
 *   a               — open attach-evidence panel
 *   u               — focus bug-URL field
 *   g g             — open goto dropdown
 *   v               — toggle focus ↔ grid view
 *   ?               — show help overlay
 *
 * Invariants:
 * - No shortcut fires when `isCapturing` is true (user is typing in a text
 *   input / textarea / contenteditable that has focus).
 * - The "f then digit" chord has a 1 500 ms window. After the window expires
 *   without a digit the pending state resets.
 * - `onFailedAtStep(n)` is only called for digit keys 1-9.
 */

import { useEffect, useRef, useCallback } from "react";

export interface UseRunnerKeyboardProps {
  /** Called when the user presses p (pass) */
  onPass: () => void;
  /** Called when the user presses f (fail) without a subsequent digit */
  onFail: () => void;
  /** Called when the user presses b (blocked) */
  onBlock: () => void;
  /** Called when the user presses s (skipped) */
  onSkip: () => void;
  /** Called when the user presses f then a digit 1-9 */
  onFailedAtStep: (stepIndex: number) => void;
  /** Navigate to previous case */
  onPrev: () => void;
  /** Navigate to next case */
  onNext: () => void;
  /** Navigate to previous row (grid mode) */
  onPrevRow?: () => void;
  /** Navigate to next row (grid mode) */
  onNextRow?: () => void;
  /** Focus the notes textarea */
  onFocusNotes: () => void;
  /** Open the attach-evidence panel */
  onAttach: () => void;
  /** Focus the bug-URL input */
  onBugUrl: () => void;
  /** Toggle focus ↔ grid view */
  onToggleView: () => void;
  /** Open the goto dropdown */
  onGoto: () => void;
  /** Show the help overlay */
  onShowHelp: () => void;
  /**
   * When true, shortcut handling is suspended.
   * Wire to the NotesField's focus state so typing never triggers actions.
   */
  isCapturing: boolean;
  /** When false the entire hook is a no-op (e.g. run is closed). */
  enabled?: boolean;
}

export function useRunnerKeyboard({
  onPass,
  onFail,
  onBlock,
  onSkip,
  onFailedAtStep,
  onPrev,
  onNext,
  onPrevRow,
  onNextRow,
  onFocusNotes,
  onAttach,
  onBugUrl,
  onToggleView,
  onGoto,
  onShowHelp,
  isCapturing,
  enabled = true,
}: UseRunnerKeyboardProps) {
  // State for two-key chords: "g g" and "f <digit>"
  const pendingChord = useRef<"g" | "f" | null>(null);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    pendingChord.current = null;
    if (chordTimer.current != null) {
      clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
  }, []);

  const armChord = useCallback(
    (chord: "g" | "f") => {
      clearChord();
      pendingChord.current = chord;
      // Auto-expire after 1 500 ms
      chordTimer.current = setTimeout(clearChord, 1500);
    },
    [clearChord],
  );

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Never fire inside a text input / textarea / contenteditable
      if (isCapturing) return;
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        tgt.isContentEditable
      )
        return;

      const key = e.key;

      // ----------------------------------------------------------------
      // Resolve pending chord
      // ----------------------------------------------------------------
      if (pendingChord.current === "f") {
        // f → digit: record fail at specific step
        if (/^[1-9]$/.test(key)) {
          e.preventDefault();
          clearChord();
          onFailedAtStep(parseInt(key, 10));
          return;
        }
        // Any other key cancels the f-chord; fall through to normal handling
        clearChord();
      }

      if (pendingChord.current === "g") {
        if (key === "g") {
          e.preventDefault();
          clearChord();
          onGoto();
          return;
        }
        // Not a valid chord completion
        clearChord();
      }

      // ----------------------------------------------------------------
      // Single-key shortcuts
      // ----------------------------------------------------------------
      switch (key) {
        case "p":
          e.preventDefault();
          onPass();
          break;

        case "f":
          // Arm the chord; if a digit follows within 1.5 s → onFailedAtStep
          armChord("f");
          break;

        case "b":
          e.preventDefault();
          onBlock();
          break;

        case "s":
          e.preventDefault();
          onSkip();
          break;

        case "ArrowLeft":
          e.preventDefault();
          onPrev();
          break;

        case "ArrowRight":
          e.preventDefault();
          onNext();
          break;

        case "ArrowUp":
          if (onPrevRow) {
            e.preventDefault();
            onPrevRow();
          }
          break;

        case "ArrowDown":
          if (onNextRow) {
            e.preventDefault();
            onNextRow();
          }
          break;

        case "n":
          e.preventDefault();
          onFocusNotes();
          break;

        case "a":
          e.preventDefault();
          onAttach();
          break;

        case "u":
          e.preventDefault();
          onBugUrl();
          break;

        case "v":
          e.preventDefault();
          onToggleView();
          break;

        case "g":
          // Arm "g g" chord
          armChord("g");
          break;

        case "?":
          e.preventDefault();
          onShowHelp();
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearChord();
    };
  }, [
    enabled,
    isCapturing,
    onPass,
    onFail,
    onBlock,
    onSkip,
    onFailedAtStep,
    onPrev,
    onNext,
    onPrevRow,
    onNextRow,
    onFocusNotes,
    onAttach,
    onBugUrl,
    onToggleView,
    onGoto,
    onShowHelp,
    armChord,
    clearChord,
  ]);

  // Expose chord state for tests / debugging
  return { pendingChord };
}
