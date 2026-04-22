/**
 * NotesField — inline textarea for run case notes.
 *
 * Design intent:
 * - Controlled textarea that saves "into" the next result record.
 *   Notes are NOT persisted separately; they are included in the next P/F/B/S
 *   recording payload as `notes: value`.
 * - Auto-expands height up to a max (no fixed height that clips content).
 * - Focusable via the `n` keyboard shortcut; notifies parent when focus
 *   state changes so the keyboard hook can suspend itself (`isCapturing`).
 * - Clean utilitarian aesthetic matching the overall runner tone — mono
 *   font input, subtle border-left accent when focused.
 */

import { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface NotesFieldProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Ref forwarded from FocusMode so the keyboard hook can call .focus()
   * when the user presses `n`.
   */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** Called when the textarea gains focus so the keyboard hook suspends */
  onFocusChange: (focused: boolean) => void;
  /** Maximum chars before a soft warning appears */
  maxLength?: number;
  disabled?: boolean;
}

const DEFAULT_MAX_LENGTH = 2000;

export function NotesField({
  value,
  onChange,
  textareaRef,
  onFocusChange,
  maxLength = DEFAULT_MAX_LENGTH,
  disabled = false,
}: NotesFieldProps) {
  // Internal ref used for auto-expand; the consumer-provided ref is also
  // assigned to the same element.
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const resolvedRef = textareaRef ?? internalRef;

  // Auto-expand height based on content
  useEffect(() => {
    const el = resolvedRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, resolvedRef]);

  const handleFocus = useCallback(() => {
    onFocusChange(true);
  }, [onFocusChange]);

  const handleBlur = useCallback(() => {
    onFocusChange(false);
  }, [onFocusChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape releases focus back to runner
      if (e.key === "Escape") {
        e.preventDefault();
        resolvedRef.current?.blur();
        onFocusChange(false);
      }
    },
    [resolvedRef, onFocusChange],
  );

  const remaining = maxLength - value.length;
  const isNearLimit = remaining < 100;
  const isOverLimit = remaining < 0;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="runner-notes"
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          Notes
          <kbd
            className="ml-2 text-[9px] font-mono opacity-40"
            aria-hidden="true"
          >
            Esc to exit
          </kbd>
        </label>
        {isNearLimit && (
          <span
            className="text-[10px] font-mono tabular-nums"
            style={{
              color: isOverLimit
                ? "var(--feedback-error-fg)"
                : "var(--feedback-warn-fg)",
            }}
            aria-live="polite"
            aria-label={`${remaining} characters remaining`}
          >
            {remaining}
          </span>
        )}
      </div>

      {/* Textarea */}
      <div
        className={cn(
          "relative rounded-lg overflow-hidden transition-all duration-100",
        )}
        style={{
          border: "1px solid var(--border-default)",
          background: "var(--bg-surface-2)",
        }}
      >
        <textarea
          ref={resolvedRef}
          id="runner-notes"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Notes for this case…"
          rows={2}
          maxLength={maxLength + 50} /* soft cap; we show warning before hard limit */
          className={cn(
            "w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed",
            "outline-none placeholder:opacity-40",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-colors duration-100",
          )}
          style={{
            color: "var(--fg-default)",
            fontFamily: "ui-monospace, 'Cascadia Code', monospace",
            minHeight: "56px",
            maxHeight: "200px",
            overflowY: "auto",
            /* Left accent rule on focus — applied via CSS class trick */
            borderLeft: "2px solid transparent",
          }}
          onFocusCapture={(e) => {
            (e.currentTarget as HTMLTextAreaElement).style.borderLeft =
              "2px solid var(--accent-primary)";
          }}
          onBlurCapture={(e) => {
            (e.currentTarget as HTMLTextAreaElement).style.borderLeft =
              "2px solid transparent";
          }}
          aria-label="Case notes"
          aria-multiline="true"
          aria-describedby={isNearLimit ? "notes-char-count" : undefined}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear notes"
            className={cn(
              "absolute bottom-1.5 right-2 text-[10px] font-medium",
              "opacity-40 hover:opacity-80 transition-opacity",
              "focus-visible:outline-none focus-visible:ring-1",
              "focus-visible:ring-[color:var(--focus-ring)] rounded",
            )}
            style={{ color: "var(--fg-muted)" }}
          >
            clear
          </button>
        )}
      </div>

      {/* Hint */}
      <p
        className="text-[10px]"
        style={{ color: "var(--fg-disabled)" }}
      >
        Saved with next result recording
      </p>
    </div>
  );
}
