/**
 * BugUrlField — input + chip list for tracking bug links on a result.
 *
 * Design:
 * - Text input for entering a URL (validated as absolute URL)
 * - "Add" on Enter or button click → appends a BugLink chip
 * - Each chip shows the URL with a link icon and a remove button
 * - Optional title input shown inline after URL validation passes
 * - Chips overflow into a scrollable row at max-width
 *
 * BugLink schema: { url: string; title?: string | null; note?: string | null }
 * We only collect url and optional title here; note is out of scope.
 */

import { useState, useRef, useCallback } from "react";
import { Link as LinkIcon, Plus, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BugLink } from "../hooks/results";

interface BugUrlFieldProps {
  value: BugLink[];
  onChange: (links: BugLink[]) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  onFocusChange: (focused: boolean) => void;
  disabled?: boolean;
}

function isValidUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const u = new URL(url);
    const display = `${u.hostname}${u.pathname}`;
    if (display.length <= maxLen) return display;
    return display.slice(0, maxLen) + "…";
  } catch {
    return url.slice(0, maxLen);
  }
}

export function BugUrlField({
  value,
  onChange,
  inputRef,
  onFocusChange,
  disabled = false,
}: BugUrlFieldProps) {
  const [draft, setDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const internalRef = useRef<HTMLInputElement>(null);
  const resolvedRef = inputRef ?? internalRef;

  const addLink = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    if (!isValidUrl(trimmed)) {
      setUrlError("Enter a valid http(s) URL");
      return;
    }

    // Deduplicate
    if (value.some((l) => l.url === trimmed)) {
      setUrlError("Already added");
      return;
    }

    onChange([...value, { url: trimmed, title: null, note: null }]);
    setDraft("");
    setUrlError(null);
  }, [draft, value, onChange]);

  const removeLink = useCallback(
    (url: string) => {
      onChange(value.filter((l) => l.url !== url));
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addLink();
      } else if (e.key === "Escape") {
        e.preventDefault();
        resolvedRef.current?.blur();
        onFocusChange(false);
      } else {
        // Clear error on typing
        if (urlError) setUrlError(null);
      }
    },
    [addLink, resolvedRef, onFocusChange, urlError],
  );

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Label */}
      <label
        htmlFor="runner-bug-url"
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--fg-muted)" }}
      >
        Bug links
        <kbd
          className="ml-2 text-[9px] font-mono opacity-40"
          aria-hidden="true"
        >
          Esc to exit
        </kbd>
      </label>

      {/* Chip list */}
      {value.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          role="list"
          aria-label="Bug links"
        >
          {value.map((link) => (
            <div
              key={link.url}
              role="listitem"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1",
                "text-[11px] font-mono",
                "transition-colors group",
              )}
              style={{
                background: "var(--bg-surface-3)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-muted)",
                maxWidth: "280px",
              }}
            >
              <LinkIcon
                className="h-3 w-3 shrink-0"
                aria-hidden="true"
                style={{ color: "var(--feedback-info-fg)" }}
              />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "truncate hover:underline",
                  "focus-visible:outline-none focus-visible:underline",
                )}
                style={{ color: "var(--fg-default)" }}
                title={link.url}
              >
                {truncateUrl(link.url)}
              </a>
              <button
                type="button"
                onClick={() => removeLink(link.url)}
                aria-label={`Remove bug link: ${link.url}`}
                className={cn(
                  "shrink-0 rounded opacity-40 hover:opacity-100",
                  "transition-opacity",
                  "focus-visible:outline-none focus-visible:ring-1",
                  "focus-visible:ring-[color:var(--focus-ring)]",
                )}
              >
                <X
                  className="h-3 w-3"
                  aria-hidden="true"
                  style={{ color: "var(--fg-default)" }}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex-1 flex items-center gap-2 rounded-lg px-3 py-2",
            "transition-all duration-100",
          )}
          style={{
            background: "var(--bg-surface-2)",
            border: `1px solid ${urlError ? "var(--feedback-error-fg)" : "var(--border-default)"}`,
          }}
        >
          <LinkIcon
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
            style={{ color: urlError ? "var(--feedback-error-fg)" : "var(--fg-muted)" }}
          />
          <input
            ref={resolvedRef}
            id="runner-bug-url"
            type="url"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (urlError) setUrlError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            placeholder="https://github.com/org/repo/issues/123"
            disabled={disabled}
            className={cn(
              "flex-1 bg-transparent text-[12px] font-mono outline-none",
              "placeholder:opacity-30",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            style={{ color: "var(--fg-default)" }}
            aria-label="Bug tracker URL"
            aria-invalid={urlError !== null}
            aria-describedby={urlError ? "bug-url-error" : undefined}
          />
        </div>

        <button
          type="button"
          onClick={addLink}
          disabled={disabled || !draft.trim()}
          aria-label="Add bug link"
          className={cn(
            "flex items-center gap-1 px-2.5 py-2 rounded-lg",
            "text-[11px] font-semibold",
            "border transition-all duration-100",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-[color:var(--focus-ring)]",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            "active:scale-95",
          )}
          style={{
            background: draft.trim() ? "var(--accent-soft)" : "var(--bg-surface-2)",
            color: draft.trim() ? "var(--accent-fg)" : "var(--fg-muted)",
            borderColor: draft.trim()
              ? "color-mix(in srgb, var(--accent-primary) 40%, transparent)"
              : "var(--border-default)",
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add
        </button>
      </div>

      {/* Validation error */}
      {urlError && (
        <div
          id="bug-url-error"
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: "var(--feedback-error-fg)" }}
          role="alert"
          aria-live="polite"
        >
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {urlError}
        </div>
      )}

      {/* Hint */}
      {value.length === 0 && !urlError && (
        <p
          className="text-[10px]"
          style={{ color: "var(--fg-disabled)" }}
        >
          Add links to bug reports or issues
        </p>
      )}
    </div>
  );
}
